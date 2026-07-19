import { z } from "zod";
import { parseReport } from "@/lib/dmarc/parser";
import { DmarcError } from "@/lib/dmarc/types";
import type { ParsedReport } from "@/lib/dmarc/types";
import type { StoreResult } from "@/lib/dmarc/store";

// The inbound webhook's policy, separated from the route so every decision is
// testable without a server: signature verification order, address routing,
// attachment selection, and the retry contract. The route wires the real
// effects (Resend SDK, admin client, network); tests inject fakes and drive the
// same code the webhook runs.
//
// The retry contract in one line: 200 for every deterministic outcome (a retry
// could never succeed, so Resend must not loop), 5xx only for transient
// infrastructure (redelivery is safe and wanted), 401 only for failed
// signature verification.

// Matches the parser's compressed-input ceiling: an attachment larger than this
// could never be a legitimate aggregate report, so it is skipped
// deterministically rather than fetched or retried.
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

// Real reports carry exactly one attachment; two tolerates an odd reporter
// while bounding what a hostile payload can make us download.
const MAX_CANDIDATES = 2;

// Thrown by downloadCapped when a body exceeds the cap: a deterministic skip,
// never a retry, so it is a distinct type the handler can tell apart from a
// transient network failure.
export class OversizeError extends Error {
  constructor() {
    super("attachment exceeds the size cap");
    this.name = "OversizeError";
  }
}

// The slice of the email.received event this route acts on. Unknown keys are
// ignored; a payload that fails this shape (or is a different event type) is
// acknowledged and dropped, never retried.
const receivedEventSchema = z.object({
  type: z.literal("email.received"),
  data: z.object({
    email_id: z.string().min(1),
    to: z.array(z.string()).default([]),
    received_for: z.array(z.string()).default([]),
    attachments: z
      .array(
        z.object({
          id: z.string(),
          filename: z.string().nullish(),
          content_type: z.string().nullish(),
        })
      )
      .default([]),
  }),
});

export type AttachmentMeta = {
  id: string;
  filename?: string | null;
  content_type?: string | null;
  size?: number | null;
  download_url?: string;
};

// Extensions and content types a DMARC aggregate report arrives as. The
// extension is the primary signal (gzip often ships as octet-stream); the type
// set catches a report with a mangled filename.
const REPORT_EXTENSIONS = [".xml", ".xml.gz", ".gz", ".zip"];
const REPORT_CONTENT_TYPES = new Set([
  "application/xml",
  "text/xml",
  "application/gzip",
  "application/x-gzip",
  "application/zip",
]);

export function isReportAttachment(meta: AttachmentMeta): boolean {
  const name = (meta.filename ?? "").toLowerCase();
  if (REPORT_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  const type = (meta.content_type ?? "").toLowerCase().split(";")[0].trim();
  return REPORT_CONTENT_TYPES.has(type);
}

// Filter a list down to fetchable report candidates: report-shaped, within the
// declared-size cap (declared sizes are untrusted, so downloadCapped enforces
// the cap again on the actual bytes), at most MAX_CANDIDATES.
export function pickCandidateAttachments(
  attachments: AttachmentMeta[]
): AttachmentMeta[] {
  return attachments
    .filter(isReportAttachment)
    .filter((a) => typeof a.size !== "number" || a.size <= MAX_ATTACHMENT_BYTES)
    .slice(0, MAX_CANDIDATES);
}

// The routing key: the first recipient on OUR ingest domain, preferring
// received_for (the envelope recipient, the delivery truth) over to (header
// addressing, which can carry unrelated recipients when we are CC'd).
// Lowercased before the exact match against dmarc_domains.ingest_address, per
// the contract note in lib/dmarc/setup.ts.
export function extractIngestAddress(
  receivedFor: string[],
  to: string[],
  ingestDomain: string
): string | null {
  const suffix = `@${ingestDomain.toLowerCase()}`;
  for (const list of [receivedFor, to]) {
    for (const entry of list) {
      const address = entry.trim().toLowerCase();
      if (address.endsWith(suffix)) return address;
    }
  }
  return null;
}

// Fetch a URL into a Buffer with a hard byte ceiling, enforced on the actual
// stream rather than trusted from content-length. Oversize is OversizeError (a
// deterministic drop); any other failure propagates as transient.
export async function downloadCapped(
  url: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch
): Promise<Buffer> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`attachment download failed with ${response.status}`);
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new OversizeError();
  }
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new OversizeError();
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new OversizeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export type InboundOutcome = {
  status: 200 | 401 | 500;
  body: Record<string, unknown>;
  // Server-side only, for the route's log line. Never sent to the caller.
  note: string;
};

export type InboundDeps = {
  // Throws on a bad signature (the Resend SDK's webhooks.verify). Returns the
  // parsed payload, which is re-validated against our own schema regardless.
  verify: (rawBody: string, headers: SvixHeaders) => unknown;
  // Row for an ingest address, null when none. Throws on a DB failure.
  resolveDomain: (address: string) => Promise<{ id: string } | null>;
  // Attachment metadata (with download URLs) for a received email. Throws on an
  // API failure.
  listAttachments: (emailId: string) => Promise<AttachmentMeta[]>;
  // Bytes for one attachment. Throws OversizeError past the cap, anything else
  // for transient failures.
  download: (url: string) => Promise<Buffer>;
  // Load known senders and run storeReport. Returns ok:false on DB failure.
  store: (domainId: string, parsed: ParsedReport) => Promise<StoreResult>;
  // Optional in-memory email_id short-circuit (per-instance, best effort). The
  // real idempotency is storeReport's (domain, report_id) unique key.
  alreadyProcessed?: (emailId: string) => boolean;
  markProcessed?: (emailId: string) => void;
};

export type SvixHeaders = {
  id: string;
  timestamp: string;
  signature: string;
};

// Every 200 carries the same body, so nothing distinguishes stored, duplicate,
// dropped or ignored to the caller; the note is for our own logs.
const ACK = { received: true };

export async function handleInbound(
  rawBody: string,
  headers: SvixHeaders,
  ingestDomain: string,
  deps: InboundDeps
): Promise<InboundOutcome> {
  // 1. Signature first, over the raw body, before anything is read from it. One
  // response for absent, stale and wrong: a prober learns nothing.
  let event: unknown;
  try {
    event = deps.verify(rawBody, headers);
  } catch {
    return {
      status: 401,
      body: { error: "invalid signature" },
      note: "invalid signature",
    };
  }

  // 2. Shape. A verified payload of the wrong event type or shape is
  // authentically Resend's, and retrying cannot change it: acknowledge, drop.
  const result = receivedEventSchema.safeParse(event);
  if (!result.success) {
    return { status: 200, body: ACK, note: "ignored: not email.received" };
  }
  const { email_id, to, received_for, attachments } = result.data.data;

  // 3. Best-effort redelivery short-circuit, after verification only (the id is
  // attacker-controlled before it).
  if (deps.alreadyProcessed?.(email_id)) {
    return { status: 200, body: ACK, note: `already processed ${email_id}` };
  }

  // 4. Routing. No match returns the same 200 as everything else: which
  // addresses exist is not observable from outside.
  const address = extractIngestAddress(received_for, to, ingestDomain);
  if (!address) {
    return { status: 200, body: ACK, note: "dropped: no ingest recipient" };
  }
  let domain: { id: string } | null;
  try {
    domain = await deps.resolveDomain(address);
  } catch {
    return {
      status: 500,
      body: { error: "server error" },
      note: "domain lookup failed",
    };
  }
  if (!domain) {
    return { status: 200, body: ACK, note: "dropped: unknown address" };
  }

  // 5. Attachments. The webhook metadata (no sizes) gates cheaply; the API list
  // (with sizes and URLs) is what is actually fetched from.
  if (!attachments.some(isReportAttachment)) {
    return { status: 200, body: ACK, note: "dropped: no report attachment" };
  }
  let listed: AttachmentMeta[];
  try {
    listed = await deps.listAttachments(email_id);
  } catch {
    return {
      status: 500,
      body: { error: "server error" },
      note: "attachment list failed",
    };
  }
  const candidates = pickCandidateAttachments(listed).filter(
    (candidate) => candidate.download_url
  );
  if (candidates.length === 0) {
    return { status: 200, body: ACK, note: "dropped: no fetchable report" };
  }

  // 6. Fetch and parse: first candidate that parses wins. Oversize and
  // unparseable are deterministic (skip / drop); a download failure is
  // transient (retry).
  let parsed: ParsedReport | null = null;
  for (const candidate of candidates) {
    let bytes: Buffer;
    try {
      bytes = await deps.download(candidate.download_url as string);
    } catch (error) {
      if (error instanceof OversizeError) continue;
      return {
        status: 500,
        body: { error: "server error" },
        note: "attachment fetch failed",
      };
    }
    try {
      parsed = await parseReport(bytes);
      break;
    } catch (error) {
      if (error instanceof DmarcError) continue;
      return {
        status: 500,
        body: { error: "server error" },
        note: "unexpected parse failure",
      };
    }
  }
  if (!parsed) {
    return { status: 200, body: ACK, note: "dropped: no parseable report" };
  }

  // 7. Store. storeReport's (domain, report_id) unique key is the real
  // idempotency: a redelivery lands here and writes nothing.
  const stored = await deps.store(domain.id, parsed);
  if (!stored.ok) {
    return {
      status: 500,
      body: { error: "server error" },
      note: "store failed",
    };
  }
  deps.markProcessed?.(email_id);
  const note = stored.duplicate
    ? `duplicate report for ${address}`
    : `stored ${stored.records} records for ${address} (${stored.day}: ${stored.state})`;
  return { status: 200, body: ACK, note };
}
