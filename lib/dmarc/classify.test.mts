import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRecord, dayState } from "@/lib/dmarc/classify";
import type { KnownSender, ParsedRecord } from "@/lib/dmarc/types";

const KNOWN: KnownSender[] = [
  { dkim_selector: "google", dkim_domain: "taverncreative.com" },
  { dkim_selector: "resend", dkim_domain: "taverncreative.com" },
];

function record(dkim: ParsedRecord["dkim"]): ParsedRecord {
  return {
    sourceIp: "1.2.3.4",
    count: 1,
    headerFrom: "taverncreative.com",
    envelopeFrom: "taverncreative.com",
    disposition: "none",
    dkim,
    spf: null,
  };
}

test("known sender passing -> ok", () => {
  const r = record([{ selector: "google", domain: "taverncreative.com", result: "pass" }]);
  assert.equal(classifyRecord(r, KNOWN), "ok");
});

test("unknown selector -> unknown", () => {
  const r = record([{ selector: "mystery", domain: "taverncreative.com", result: "pass" }]);
  assert.equal(classifyRecord(r, KNOWN), "unknown");
});

test("known sender failing -> broken (matched-DKIM-fail)", () => {
  const r = record([{ selector: "google", domain: "taverncreative.com", result: "fail" }]);
  assert.equal(classifyRecord(r, KNOWN), "broken");
});

test("scans ALL dkim blocks: resend match wins past a non-matching amazonses block", () => {
  const r = record([
    { selector: "resend", domain: "taverncreative.com", result: "pass" },
    { selector: "shh3fegwg5fppqsuzphvschd53n6ihuv", domain: "amazonses.com", result: "pass" },
  ]);
  assert.equal(classifyRecord(r, KNOWN), "ok");
});

test("match is by selector AND domain, not selector alone", () => {
  // Right selector, wrong domain -> not a match -> unknown.
  const r = record([{ selector: "google", domain: "evil.example", result: "pass" }]);
  assert.equal(classifyRecord(r, KNOWN), "unknown");
});

test("day state precedence: any broken -> danger, even alongside unknown", () => {
  assert.equal(dayState(["ok", "unknown", "broken"]), "danger");
  assert.equal(dayState(["ok", "unknown"]), "warn");
  assert.equal(dayState(["ok", "ok"]), "ok");
  assert.equal(dayState([]), "ok");
});
