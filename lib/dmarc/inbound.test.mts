import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resend } from "resend";
import {
  MAX_ATTACHMENT_BYTES,
  OversizeError,
  downloadCapped,
  extractIngestAddress,
  handleInbound,
  pickCandidateAttachments,
  type AttachmentMeta,
  type InboundDeps,
} from "@/lib/dmarc/inbound";
import type { ParsedReport } from "@/lib/dmarc/types";
import type { StoreResult } from "@/lib/dmarc/store";

// The webhook policy, driven through REAL signature verification (the Resend
// SDK's webhooks.verify, the same call the route makes) with signatures crafted
// against the Standard Webhooks scheme, and the REAL parser fed the real
// Outlook fixture. Only the network and DB seams are faked.

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(
  resolve(here, "__fixtures__/outlook-taverncreative.xml")
);

const SECRET = `whsec_${randomBytes(24).toString("base64")}`;
const INGEST_DOMAIN = "inbound.taverncreative.com";
const ADDRESS = `dmarc+abc123@${INGEST_DOMAIN}`;

const resend = new Resend("re_test_dummy_key");
const verify: InboundDeps["verify"] = (payload, headers) =>
  resend.webhooks.verify({ payload, headers, webhookSecret: SECRET });

// A genuine signature for the payload: HMAC-SHA256 over `${id}.${ts}.${payload}`
// keyed on the base64-decoded secret, exactly what verification recomputes.
function sign(payload: string, id = "msg_test_1") {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(SECRET.slice("whsec_".length), "base64");
  const digest = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");
  return { id, timestamp, signature: `v1,${digest}` };
}

function eventBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "email.received",
    created_at: "2026-07-19T05:00:00.000Z",
    data: {
      email_id: "em_test_1",
      from: "dmarcreport@microsoft.com",
      to: [ADDRESS],
      received_for: [ADDRESS],
      subject: "Report Domain: taverncreative.com",
      attachments: [
        {
          id: "att_1",
          filename: "report.xml",
          content_type: "application/xml",
        },
      ],
      ...overrides,
    },
  });
}

type StoreCall = { domainId: string; parsed: ParsedReport };

// Deps with working defaults for the happy path; override per test. Every fake
// records its calls so tests assert what did NOT run as much as what did.
function makeDeps(overrides: Partial<InboundDeps> = {}) {
  const storeCalls: StoreCall[] = [];
  const resolveCalls: string[] = [];
  const deps: InboundDeps = {
    verify,
    resolveDomain: async (address) => {
      resolveCalls.push(address);
      return address === ADDRESS ? { id: "dom_1" } : null;
    },
    listAttachments: async () => [
      {
        id: "att_1",
        filename: "report.xml",
        content_type: "application/xml",
        size: fixture.length,
        download_url: "https://resend.test/att_1",
      },
    ],
    download: async () => fixture,
    store: async (domainId, parsed) => {
      storeCalls.push({ domainId, parsed });
      return {
        ok: true,
        duplicate: false,
        records: parsed.records.length,
        day: "2026-07-15",
        state: "ok",
      } satisfies StoreResult;
    },
    ...overrides,
  };
  return { deps, storeCalls, resolveCalls };
}

test("valid signature + real fixture attachment stores the parsed report", async () => {
  const body = eventBody();
  const { deps, storeCalls } = makeDeps();
  const outcome = await handleInbound(body, sign(body), INGEST_DOMAIN, deps);

  assert.equal(outcome.status, 200);
  assert.deepEqual(outcome.body, { received: true });
  assert.equal(storeCalls.length, 1);
  assert.equal(storeCalls[0].domainId, "dom_1");
  assert.equal(storeCalls[0].parsed.records.length, 3);
  assert.equal(
    storeCalls[0].parsed.reportId,
    "08478dabfdba4012abc01b9e5b025c28"
  );
});

test("bad signature is 401 before anything is read", async () => {
  const body = eventBody();
  const headers = sign(body);
  const tampered = body.replace("em_test_1", "em_evil_1");
  const { deps, storeCalls, resolveCalls } = makeDeps();
  const outcome = await handleInbound(tampered, headers, INGEST_DOMAIN, deps);

  assert.equal(outcome.status, 401);
  assert.equal(resolveCalls.length, 0);
  assert.equal(storeCalls.length, 0);
});

test("missing signature headers are 401", async () => {
  const body = eventBody();
  const { deps, storeCalls } = makeDeps();
  const outcome = await handleInbound(
    body,
    { id: "", timestamp: "", signature: "" },
    INGEST_DOMAIN,
    deps
  );
  assert.equal(outcome.status, 401);
  assert.equal(storeCalls.length, 0);
});

test("unknown address is a silent 200 no-op", async () => {
  const stranger = `dmarc+unknown@${INGEST_DOMAIN}`;
  const body = eventBody({ to: [stranger], received_for: [stranger] });
  const { deps, storeCalls } = makeDeps();
  const outcome = await handleInbound(body, sign(body), INGEST_DOMAIN, deps);

  assert.equal(outcome.status, 200);
  // Indistinguishable from success to the caller: same body as the stored case.
  assert.deepEqual(outcome.body, { received: true });
  assert.equal(storeCalls.length, 0);
});

test("redelivery dedupes via storeReport's duplicate result", async () => {
  const body = eventBody();
  const { deps, storeCalls } = makeDeps({
    store: async () => ({ ok: true, duplicate: true }),
  });
  const outcome = await handleInbound(body, sign(body), INGEST_DOMAIN, deps);

  assert.equal(outcome.status, 200);
  assert.equal(storeCalls.length, 0); // the override recorded nothing extra
  assert.match(outcome.note, /duplicate/);
});

test("redelivery short-circuits on a seen email_id without refetching", async () => {
  const body = eventBody();
  let listed = 0;
  const { deps, storeCalls } = makeDeps({
    alreadyProcessed: () => true,
    listAttachments: async () => {
      listed += 1;
      return [];
    },
  });
  const outcome = await handleInbound(body, sign(body), INGEST_DOMAIN, deps);

  assert.equal(outcome.status, 200);
  assert.equal(listed, 0);
  assert.equal(storeCalls.length, 0);
});

test("malformed attachment is 200, never a retry", async () => {
  const body = eventBody();
  const { deps, storeCalls } = makeDeps({
    download: async () => Buffer.from("<html>not a dmarc report</html>"),
  });
  const outcome = await handleInbound(body, sign(body), INGEST_DOMAIN, deps);

  assert.equal(outcome.status, 200);
  assert.equal(storeCalls.length, 0);
});

test("hostile doctype attachment is 200 dropped, not stored", async () => {
  const body = eventBody();
  const { deps, storeCalls } = makeDeps({
    download: async () =>
      Buffer.from(
        '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY y "z">]><feedback/>'
      ),
  });
  const outcome = await handleInbound(body, sign(body), INGEST_DOMAIN, deps);

  assert.equal(outcome.status, 200);
  assert.equal(storeCalls.length, 0);
});

test("transient download failure is 500 so Resend retries", async () => {
  const body = eventBody();
  const { deps } = makeDeps({
    download: async () => {
      throw new Error("network");
    },
  });
  const outcome = await handleInbound(body, sign(body), INGEST_DOMAIN, deps);
  assert.equal(outcome.status, 500);
});

test("store failure is 500 so Resend retries", async () => {
  const body = eventBody();
  const { deps } = makeDeps({
    store: async () => ({ ok: false, error: "db down" }),
  });
  const outcome = await handleInbound(body, sign(body), INGEST_DOMAIN, deps);
  assert.equal(outcome.status, 500);
});

test("wrong event type is acknowledged and ignored", async () => {
  const body = JSON.stringify({ type: "email.sent", data: { email_id: "x" } });
  const { deps, storeCalls } = makeDeps();
  const outcome = await handleInbound(body, sign(body), INGEST_DOMAIN, deps);
  assert.equal(outcome.status, 200);
  assert.equal(storeCalls.length, 0);
});

test("extractIngestAddress prefers received_for, falls back to to, lowercases", () => {
  assert.equal(
    extractIngestAddress(
      ["other@elsewhere.com", `DMARC+ToK@${INGEST_DOMAIN}`],
      [],
      INGEST_DOMAIN
    ),
    `dmarc+tok@${INGEST_DOMAIN}`
  );
  assert.equal(extractIngestAddress([], [ADDRESS], INGEST_DOMAIN), ADDRESS);
  assert.equal(
    extractIngestAddress(["someone@gmail.com"], ["x@y.com"], INGEST_DOMAIN),
    null
  );
});

test("pickCandidateAttachments filters non-reports, oversizes, and caps at two", () => {
  const meta = (m: Partial<AttachmentMeta>): AttachmentMeta => ({
    id: "a",
    ...m,
  });
  const picked = pickCandidateAttachments([
    meta({ id: "1", filename: "report.xml.gz", size: 1000 }),
    meta({ id: "2", filename: "image.png", content_type: "image/png" }),
    meta({ id: "3", filename: "big.zip", size: MAX_ATTACHMENT_BYTES + 1 }),
    meta({ id: "4", content_type: "application/zip", size: 10 }),
    meta({ id: "5", filename: "another.xml", size: 10 }),
  ]);
  assert.deepEqual(
    picked.map((p) => p.id),
    ["1", "4"]
  );
});

test("downloadCapped rejects an oversized body with OversizeError", async () => {
  const big = new Uint8Array(1024);
  const fakeFetch = (async () =>
    new Response(big, { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(
    () => downloadCapped("https://x.test/a", 512, fakeFetch),
    OversizeError
  );
  const ok = await downloadCapped("https://x.test/a", 2048, fakeFetch);
  assert.equal(ok.length, 1024);
});
