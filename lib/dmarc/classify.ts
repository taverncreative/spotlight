import type {
  Classification,
  DayState,
  KnownSender,
  ParsedRecord,
} from "@/lib/dmarc/types";

// Classify one record against a domain's known senders. Matching is by DKIM
// selector + domain ONLY, never by IP: an IP can be shared or spoofed, a DKIM
// signature is the sender's own key. A record may carry several DKIM blocks (the
// sample's resend + amazonses), so every block is scanned for a match.
//
//   no match         -> unknown  (someone sent as your domain who we do not expect)
//   match + pass     -> ok       (an expected sender, authenticating)
//   match + not pass -> broken   (an expected sender FAILING authentication)
export function classifyRecord(
  record: ParsedRecord,
  known: KnownSender[]
): Classification {
  const match = record.dkim.find((d) =>
    known.some(
      (k) => k.dkim_selector === d.selector && k.dkim_domain === d.domain
    )
  );
  if (!match) return "unknown";
  return match.result === "pass" ? "ok" : "broken";
}

// A day's state from its records' classifications. Precedence is deliberate and
// load-bearing: a known sender failing authentication (broken -> danger) must win
// over everything, then an unknown source (warn), else all clear (ok).
export function dayState(classifications: Classification[]): DayState {
  if (classifications.includes("broken")) return "danger";
  if (classifications.includes("unknown")) return "warn";
  return "ok";
}
