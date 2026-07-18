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

export type DomainPanel = {
  id: string;
  domain: string;
  // null when the domain has no reports yet -> the empty ("waiting") state.
  latest: { state: "ok" | "warn" | "danger"; tone: PanelTone; label: string } | null;
  strip: StripDay[];
  offenders: {
    sourceIp: string;
    selectors: string;
    count: number;
    classification: "unknown" | "broken";
  }[];
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
  domains: { id: string; domain: string }[],
  daily: DailyRow[],
  offenders: OffenderRow[],
  today: string
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
                o.dkim.map((d) => `${d.selector || "(none)"}@${d.domain}`).join(", ") ||
                "no DKIM signature",
              count: o.email_count,
              classification: o.classification,
            }))
        : [];

    return {
      id: domain.id,
      domain: domain.domain,
      latest: latestRow
        ? { state: latestRow.state, tone: latestRow.state, label: labelFor(latestRow) }
        : null,
      strip,
      offenders: latestOffenders,
    };
  });
}
