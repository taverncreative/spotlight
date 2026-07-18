// Pure shaping for the Email health view: turn the raw dmarc_daily rollup and the
// offender records into per-domain, render-ready panels. No client clock and no
// DB access here -- the page passes "today" so the 30-day strip stays a pure,
// testable function, matching how lib/sites/monitoring.ts builds site health.

export type PanelTone = "ok" | "warn" | "danger" | "muted";

export type DailyRow = {
  dmarc_domain_id: string;
  day: string; // YYYY-MM-DD
  state: "ok" | "warn" | "danger";
  email_count: number;
  unknown_count: number;
  broken_count: number;
};

export type OffenderRow = {
  dmarc_domain_id: string;
  day: string; // the report window's UTC day
  source_ip: string | null;
  email_count: number;
  // [{ selector, domain, result }]
  dkim: { selector: string; domain: string; result: string }[];
  classification: "unknown" | "broken";
};

export type StripDay = { day: string; tone: PanelTone };

// The DNS-setup strings for a domain, all derived from its stored ingest_address
// and dmarc_record so what the operator copies is byte-identical to what routes.
export type DomainSetup = {
  ingestAddress: string;
  ruaMailto: string; // mailto:<address>, to merge into an existing rua= tag
  ruaFragment: string; // rua=mailto:<address>, the whole tag to add
  fullRecord: string; // the full v=DMARC1 record, fallback for no existing DMARC
  reportAuthHost: string; // <domain>._report._dmarc.<ingest domain>
  reportAuthValue: string; // v=DMARC1;
};

export type DomainPanel = {
  id: string;
  domain: string;
  // true until dmarc_daily has a row: added but awaiting the first report.
  pending: boolean;
  setup: DomainSetup;
  // null when the domain has no reports yet -> the empty ("waiting") state.
  latest: {
    state: "ok" | "warn" | "danger";
    tone: PanelTone;
    label: string;
  } | null;
  strip: StripDay[];
  offenders: {
    sourceIp: string;
    selectors: string;
    count: number;
    classification: "unknown" | "broken";
  }[];
};

// The domain fields buildPanels needs: identity plus the stored routing address
// and record the setup strings are built from.
export type DomainInput = {
  id: string;
  domain: string;
  ingest_address: string;
  dmarc_record: string | null;
};

const MAX_OFFENDERS = 5;
const STRIP_DAYS = 30;

// The four-word reassurance is the whole glanceable answer. ok carries the count;
// warn/danger are fixed and deliberately unalarming-but-clear.
function labelFor(row: DailyRow): string {
  if (row.state === "ok") {
    return `${row.email_count} ${row.email_count === 1 ? "email" : "emails"} · all expected senders`;
  }
  if (row.state === "warn") return "Unknown source sent as your domain";
  return "A known sender is failing authentication";
}

// Calendar day N days back from `today` (YYYY-MM-DD), UTC, no clock read here.
function dayOffset(today: string, back: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export function buildPanels(
  domains: DomainInput[],
  daily: DailyRow[],
  offenders: OffenderRow[],
  today: string,
  ingestDomain: string
): DomainPanel[] {
  return domains.map((domain) => {
    const rows = daily
      .filter((r) => r.dmarc_domain_id === domain.id)
      .sort((a, b) => (a.day < b.day ? 1 : -1)); // newest first
    const latestRow = rows[0] ?? null;
    const byDay = new Map(rows.map((r) => [r.day, r]));

    // 30 slots, oldest -> newest, so the strip reads left (old) to right (today).
    const strip: StripDay[] = [];
    for (let i = STRIP_DAYS - 1; i >= 0; i--) {
      const day = dayOffset(today, i);
      strip.push({ day, tone: byDay.get(day)?.state ?? "muted" });
    }

    // Offenders belong to the latest day only, and only when that day is not ok.
    const latestOffenders =
      latestRow && latestRow.state !== "ok"
        ? offenders
            .filter(
              (o) => o.dmarc_domain_id === domain.id && o.day === latestRow.day
            )
            .sort((a, b) => b.email_count - a.email_count)
            .slice(0, MAX_OFFENDERS)
            .map((o) => ({
              sourceIp: o.source_ip ?? "unknown IP",
              selectors:
                o.dkim
                  .map((d) => `${d.selector || "(none)"}@${d.domain}`)
                  .join(", ") || "no DKIM signature",
              count: o.email_count,
              classification: o.classification,
            }))
        : [];

    // Setup strings, all from the one stored address so the copyable value the
    // operator pastes is byte-identical to the routing key the webhook matches.
    const mailto = `mailto:${domain.ingest_address}`;
    const setup: DomainSetup = {
      ingestAddress: domain.ingest_address,
      ruaMailto: mailto,
      ruaFragment: `rua=${mailto}`,
      fullRecord:
        domain.dmarc_record ?? `v=DMARC1; p=none; rua=${mailto}; fo=1`,
      reportAuthHost: `${domain.domain}._report._dmarc.${ingestDomain}`,
      reportAuthValue: "v=DMARC1;",
    };

    return {
      id: domain.id,
      domain: domain.domain,
      pending: latestRow === null,
      setup,
      latest: latestRow
        ? {
            state: latestRow.state,
            tone: latestRow.state,
            label: labelFor(latestRow),
          }
        : null,
      strip,
      offenders: latestOffenders,
    };
  });
}
