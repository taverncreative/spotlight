import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, crc32 } from "node:zlib";
import { parseReport, parseXml } from "@/lib/dmarc/parser";
import { DmarcError } from "@/lib/dmarc/types";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  resolve(here, "__fixtures__/outlook-taverncreative.xml")
);

// A minimal, valid stored-method (uncompressed) ZIP, built by hand so the tests
// can exercise the real zip branch without a zip-writing dependency. Uses Node's
// zlib.crc32 for the per-entry checksum yauzl verifies.
function makeStoredZip(entries: { name: string; content: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, content } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const sum = crc32(content) >>> 0;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header sig
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method 0 = stored
    local.writeUInt32LE(0, 10); // mod time/date
    local.writeUInt32LE(sum, 14); // crc32
    local.writeUInt32LE(content.length, 18); // compressed size
    local.writeUInt32LE(content.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    nameBuf.copy(local, 30);
    locals.push(local, content);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); // central dir header sig
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42); // local header offset
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length + content.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

test("raw .xml fixture parses to 3 records with the right report_id", async () => {
  const report = await parseReport(FIXTURE);
  assert.equal(report.reportId, "08478dabfdba4012abc01b9e5b025c28");
  assert.equal(report.policyDomain, "taverncreative.com");
  assert.equal(report.records.length, 3);
});

test("a record with several DKIM blocks normalises to an array (resend + amazonses)", async () => {
  const report = await parseReport(FIXTURE);
  const third = report.records[2];
  assert.equal(third.dkim.length, 2);
  assert.deepEqual(
    third.dkim.map((d) => d.selector).sort(),
    ["resend", "shh3fegwg5fppqsuzphvschd53n6ihuv"]
  );
});

test("a single-DKIM record still normalises to a 1-element array", async () => {
  const report = await parseReport(FIXTURE);
  assert.equal(report.records[0].dkim.length, 1);
  assert.equal(report.records[0].dkim[0].selector, "google");
});

test("format detection by magic bytes: gzip of the fixture parses identically", async () => {
  const gz = gzipSync(FIXTURE);
  assert.equal(gz[0], 0x1f); // sanity: it really is gzip
  const report = await parseReport(gz);
  assert.equal(report.records.length, 3);
  assert.equal(report.reportId, "08478dabfdba4012abc01b9e5b025c28");
});

test("format detection by magic bytes: a stored ZIP of the fixture parses", async () => {
  const zip = makeStoredZip([{ name: "report.xml", content: FIXTURE }]);
  assert.equal(zip[0], 0x50); // "P"
  assert.equal(zip[1], 0x4b); // "K"
  const report = await parseReport(zip);
  assert.equal(report.records.length, 3);
});

test("a lying filename cannot reroute: gzip bytes named .xml still gunzips", async () => {
  // The bytes are gzip; there is no filename involved, which is the point --
  // detection is by content, so this simply confirms the gzip path is taken.
  const gz = gzipSync(FIXTURE);
  const report = await parseReport(gz);
  assert.equal(report.records.length, 3);
});

test("XXE kill switch: a DOCTYPE declaration is rejected before parsing", () => {
  const hostile = `<?xml version="1.0"?>
<!DOCTYPE feedback [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<feedback><report_metadata><report_id>x</report_id></report_metadata></feedback>`;
  assert.throws(() => parseXml(hostile), (e) => e instanceof DmarcError && /DTD or entity/.test(e.message));
});

test("XXE kill switch: a bare ENTITY declaration is rejected too", () => {
  const hostile = `<?xml version="1.0"?><!ENTITY a "b"><feedback></feedback>`;
  assert.throws(() => parseXml(hostile), (e) => e instanceof DmarcError);
});

test("decompression bomb: a gzip that inflates past the cap throws, does not OOM", async () => {
  // 21 MB of zeros gzips to a few KB and inflates past the 20 MB cap.
  const bomb = gzipSync(Buffer.alloc(21 * 1024 * 1024));
  await assert.rejects(
    () => parseReport(bomb),
    (e) => e instanceof DmarcError && /size limit/.test(e.message)
  );
});

test("zip with too many entries is rejected", async () => {
  const zip = makeStoredZip([
    { name: "a.xml", content: FIXTURE },
    { name: "b.xml", content: FIXTURE },
    { name: "c.xml", content: FIXTURE },
    { name: "d.xml", content: FIXTURE },
  ]);
  await assert.rejects(
    () => parseReport(zip),
    (e) => e instanceof DmarcError && /too many entries/.test(e.message)
  );
});

test("a malformed zip fails safe as a DmarcError, not a raw throw", async () => {
  const fakeZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00]);
  await assert.rejects(() => parseReport(fakeZip), (e) => e instanceof DmarcError);
});

test("non-DMARC XML is rejected", () => {
  assert.throws(() => parseXml("<html><body>nope</body></html>"), (e) => e instanceof DmarcError);
});
