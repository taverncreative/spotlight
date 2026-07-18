// The shapes a parsed DMARC aggregate report is normalised into, independent of
// which provider sent it or which container format it arrived in. Everything the
// classifier and store need, nothing they do not.

export type DkimResult = {
  domain: string;
  selector: string;
  // pass | fail | neutral | temperror | permerror | none — kept as the raw
  // string; the classifier only cares whether it is exactly "pass".
  result: string;
};

export type SpfResult = {
  domain: string;
  result: string;
};

export type ParsedRecord = {
  sourceIp: string | null;
  count: number;
  headerFrom: string | null;
  envelopeFrom: string | null;
  disposition: string | null;
  // Every DKIM block in auth_results, always an array (a record may carry
  // several -- the sample's resend + amazonses). The classifier scans all of
  // them for a known (selector, domain).
  dkim: DkimResult[];
  spf: SpfResult | null;
};

export type ParsedReport = {
  reportId: string;
  orgName: string | null;
  policyDomain: string | null;
  // Unix seconds in the source; kept as numbers here, converted to timestamps at
  // the store boundary.
  windowBegin: number;
  windowEnd: number;
  records: ParsedRecord[];
};

// A record's derived state. broken = a known sender whose matched DKIM failed.
export type Classification = "ok" | "unknown" | "broken";

// A day's rolled-up state. danger (any broken) > warn (any unknown) > ok.
export type DayState = "ok" | "warn" | "danger";

export type KnownSender = {
  dkim_selector: string;
  dkim_domain: string;
};

// Every failure the parser raises is a DmarcError, so a caller (the slice 2
// webhook) can distinguish "this input is bad/hostile" from an unexpected bug.
export class DmarcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DmarcError";
  }
}
