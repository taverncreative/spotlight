import "server-only";
import { randomBytes } from "node:crypto";

// The setup primitives for a monitored domain: the routing address, the DNS
// record built from it, and the default known senders. Server-only: it reads a
// crypto source and an env constant, and its output (an unguessable address) is
// the routing key, so it must never be bundled into client code.
//
// The address is unguessable but NOT secret -- it is published in the domain's
// public _dmarc DNS. So it is stored plaintext in dmarc_domains.ingest_address
// (the unique routing key) and matched by exact equality at the webhook; the
// random token defends against enumeration and blind forgery, not disclosure.

// One catch-all Resend inbound route lives on this domain, so every
// dmarc+<token>@ address flows to the same webhook -- no per-domain Resend
// config. Env-backed so slice 2's webhook and any script read the same value.
export const INGEST_DOMAIN =
  process.env.DMARC_INGEST_DOMAIN ?? "inbound.taverncreative.com";

// A 128-bit token, hex so the address is all-lowercase and email-safe (local
// parts are treated case-insensitively in practice, which base64url's mixed case
// would make ambiguous on the round-trip). The webhook lowercases the received-to
// address before its exact-match lookup, matching what we generate here.
export function generateIngestAddress(): { token: string; address: string } {
  const token = randomBytes(16).toString("hex");
  return { token, address: `dmarc+${token}@${INGEST_DOMAIN}` };
}

// The full DMARC record, for a domain with no existing policy. p=none is
// monitor-only: adding a domain must never publish an enforcing policy that could
// affect the domain's live mail delivery. The rua points at the exact address we
// store, so a report mailed to it matches ingest_address on the way back in.
export function buildDmarcRecord(address: string): string {
  return `v=DMARC1; p=none; rua=mailto:${address}; fo=1`;
}

// The fragment for a domain that ALREADY has a DMARC record: the operator keeps
// their current policy and merges only this rua target in. Same address, so the
// copyable value is byte-identical to what buildDmarcRecord embeds.
export function buildRuaFragment(address: string): string {
  return `rua=mailto:${address}`;
}

// The external-destination-authorisation record, published on OUR ingest domain
// (which Spotlight controls), without which conforming reporters refuse to send
// reports to an address on a different domain than the one being reported on.
export function buildReportAuthHost(domain: string): string {
  return `${domain}._report._dmarc.${INGEST_DOMAIN}`;
}

// Sensible starting senders for the common case (each provider signing with
// d=<the domain>). A seeded sender that never matches is harmless -- it simply
// never fires -- and the panel's warn detail shows the real selector@domain of
// any unknown sender, so the operator corrects these from what they actually see.
export function defaultKnownSenders(domain: string): Array<{
  label: string;
  dkim_selector: string;
  dkim_domain: string;
  envelope_domain: string | null;
}> {
  return [
    {
      label: "Google Workspace",
      dkim_selector: "google",
      dkim_domain: domain,
      envelope_domain: null,
    },
    {
      label: "Microsoft 365",
      dkim_selector: "selector1",
      dkim_domain: domain,
      envelope_domain: null,
    },
    {
      label: "Microsoft 365 (2)",
      dkim_selector: "selector2",
      dkim_domain: domain,
      envelope_domain: null,
    },
    {
      label: "Resend",
      dkim_selector: "resend",
      dkim_domain: domain,
      envelope_domain: `send.${domain}`,
    },
  ];
}

// Normalise operator input to a bare hostname, or null if it is not a plausible
// domain. Accepts a pasted URL (strips scheme/path) and lowercases, so the value
// stored and shown is consistent with the DKIM-domain comparisons downstream.
export function normaliseDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  if (value.includes("://")) {
    try {
      value = new URL(value).hostname;
    } catch {
      return null;
    }
  } else {
    value = value.split("/")[0];
  }
  value = value.replace(/^\.+|\.+$/g, "");
  const hostname =
    /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
  return hostname.test(value) ? value : null;
}
