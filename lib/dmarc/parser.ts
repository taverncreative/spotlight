import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import yauzl from "yauzl";
import { XMLParser } from "fast-xml-parser";
import {
  DmarcError,
  type DkimResult,
  type ParsedRecord,
  type ParsedReport,
  type SpfResult,
} from "@/lib/dmarc/types";

// Parse a DMARC aggregate report from any of the three container formats a
// provider emails: raw .xml, gzip (.xml.gz), or a .zip holding one .xml.
//
// SECURITY. This is fed untrusted email in slice 2, so hardening is structural,
// not configured:
//   - Format is decided by MAGIC BYTES, so a lying filename cannot reroute us.
//   - XXE and billion-laughs are killed BEFORE the XML parser runs, by rejecting
//     any input that declares a DTD or entity. DMARC reports never carry one.
//   - fast-xml-parser never resolves DTDs or external entities regardless, so
//     even past the pre-check there is nothing to fetch.
//   - Decompression is capped MID-STREAM, so a bomb never fully inflates, and zip
//     entry counts are capped. Declared sizes are never trusted.

const MAX_COMPRESSED = 5 * 1024 * 1024; // reject the input outright past this
const MAX_DECOMPRESSED = 20 * 1024 * 1024; // abort decompression past this
const MAX_ZIP_ENTRIES = 3; // a DMARC zip holds exactly one .xml

export async function parseReport(input: Buffer): Promise<ParsedReport> {
  if (input.byteLength > MAX_COMPRESSED) {
    throw new DmarcError("input exceeds the compressed size limit");
  }

  const isGzip = input[0] === 0x1f && input[1] === 0x8b;
  const isZip = input[0] === 0x50 && input[1] === 0x4b; // "PK"
  const xml = isGzip
    ? await gunzipCapped(input)
    : isZip
      ? await unzipXmlCapped(input)
      : input;

  return parseXml(xml.toString("utf8"));
}

// Exported for the tests: the XML step in isolation, so the DOCTYPE/ENTITY
// kill-switch can be exercised without a container.
export function parseXml(text: string): ParsedReport {
  // The kill switch. A DTD or entity declaration in a DMARC report is an attack
  // (external-entity read/SSRF, or nested-entity expansion), so reject before the
  // parser touches the string. This is what makes XXE structurally impossible
  // here rather than merely disabled.
  if (/<!doctype/i.test(text) || /<!entity/i.test(text)) {
    throw new DmarcError("DTD or entity declaration is not allowed");
  }

  const parser = new XMLParser({
    ignoreAttributes: true,
    // Do not coerce values (IPs, selectors, hex report ids stay strings).
    parseTagValue: false,
    trimValues: true,
  });

  let doc: unknown;
  try {
    doc = parser.parse(text);
  } catch {
    throw new DmarcError("malformed XML");
  }

  const feedback = (doc as { feedback?: unknown })?.feedback;
  if (!feedback || typeof feedback !== "object") {
    throw new DmarcError("not a DMARC aggregate report (no <feedback>)");
  }
  return normalize(feedback as FeedbackXml);
}

// --- decompression, capped mid-stream ---------------------------------------

async function gunzipCapped(input: Buffer): Promise<Buffer> {
  return collectCapped(Readable.from(input).pipe(createGunzip()));
}

async function unzipXmlCapped(input: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    yauzl.fromBuffer(input, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(new DmarcError("invalid zip"));
      if (zip.entryCount > MAX_ZIP_ENTRIES) {
        zip.close();
        return reject(new DmarcError("zip has too many entries"));
      }
      let handled = false;
      zip.on("entry", (entry: yauzl.Entry) => {
        if (handled || !/\.xml$/i.test(entry.fileName)) return zip.readEntry();
        handled = true;
        // uncompressedSize is NOT trusted; collectCapped counts real bytes.
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return reject(new DmarcError("unreadable zip entry"));
          collectCapped(stream).then(resolve, reject);
        });
      });
      zip.on("end", () => {
        if (!handled) reject(new DmarcError("no .xml entry in zip"));
      });
      zip.readEntry();
    });
  });
}

// Drain a stream into a Buffer, aborting the moment the running total crosses the
// decompressed cap. This is what defuses a decompression bomb: the source is
// destroyed before it can inflate to exhaustion.
function collectCapped(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    stream.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > MAX_DECOMPRESSED) {
        (stream as unknown as { destroy: (e?: Error) => void }).destroy();
        reject(new DmarcError("decompressed output exceeds the size limit"));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", () => reject(new DmarcError("decompression failed")));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// --- normalisation ----------------------------------------------------------

// fast-xml-parser yields a single object for one child and an array for several,
// so every repeatable element is coerced to an array here.
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

type FeedbackXml = {
  report_metadata?: {
    org_name?: unknown;
    report_id?: unknown;
    date_range?: { begin?: unknown; end?: unknown };
  };
  policy_published?: { domain?: unknown };
  record?: RecordXml | RecordXml[];
};

function normalize(feedback: FeedbackXml): ParsedReport {
  const meta = feedback.report_metadata ?? {};
  const reportId = str(meta.report_id);
  if (!reportId) throw new DmarcError("report has no report_id");

  const begin = Number(meta.date_range?.begin);
  const end = Number(meta.date_range?.end);
  if (!Number.isFinite(begin) || !Number.isFinite(end)) {
    throw new DmarcError("report has no valid date_range");
  }

  return {
    reportId,
    orgName: str(meta.org_name),
    policyDomain: str(feedback.policy_published?.domain),
    windowBegin: begin,
    windowEnd: end,
    records: asArray(feedback.record).map(normalizeRecord),
  };
}

type RecordXml = {
  row?: {
    source_ip?: unknown;
    count?: unknown;
    policy_evaluated?: { disposition?: unknown };
  };
  identifiers?: { header_from?: unknown; envelope_from?: unknown };
  auth_results?: { dkim?: unknown; spf?: unknown };
};

function normalizeRecord(record: RecordXml): ParsedRecord {
  const row = record.row ?? {};
  const auth = record.auth_results ?? {};
  const ids = record.identifiers ?? {};

  const dkim: DkimResult[] = asArray(
    auth.dkim as { domain?: unknown; selector?: unknown; result?: unknown } | undefined
  ).map((d) => ({
    domain: str(d.domain) ?? "",
    selector: str(d.selector) ?? "",
    result: (str(d.result) ?? "").toLowerCase(),
  }));

  const spfRaw = asArray(
    auth.spf as { domain?: unknown; result?: unknown } | undefined
  )[0];
  const spf: SpfResult | null = spfRaw
    ? { domain: str(spfRaw.domain) ?? "", result: (str(spfRaw.result) ?? "").toLowerCase() }
    : null;

  const count = Number(row.count);
  return {
    sourceIp: str(row.source_ip),
    count: Number.isFinite(count) ? count : 0,
    headerFrom: str(ids.header_from),
    envelopeFrom: str(ids.envelope_from),
    disposition: str(row.policy_evaluated?.disposition),
    dkim,
    spf,
  };
}
