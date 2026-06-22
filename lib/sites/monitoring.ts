import { hostnameFromUrl } from "@/lib/sites/schemas";

// Display model for the Sites list. The page computes this server-side (so the
// client list renders ready-made strings and tones, with no client-side clock
// and no hydration mismatch), then Slice 7's real checks light it up.

export type ChipTone = "ok" | "warn" | "danger" | "muted";

export type SiteCheckView = {
  status: "up" | "down";
  statusTone: ChipTone;
  httpStatus: number | null;
  responseMs: number | null;
  ssl: { label: string; tone: ChipTone } | null;
  domain: { label: string; tone: ChipTone } | null;
  checkedAtLabel: string;
};

export type SiteView = {
  id: string;
  url: string;
  label: string | null;
  hostname: string;
  monitoringEnabled: boolean;
  checkIntervalMinutes: number;
  gscProperty: string | null;
  ga4Property: string | null;
  check: SiteCheckView | null;
};

// Amber thresholds for "at risk"; below zero days is expired (red).
const SSL_WARN_DAYS = 14;
const DOMAIN_WARN_DAYS = 30;
const DAY_MS = 86_400_000;

function daysUntil(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  return Math.floor((target - now) / DAY_MS);
}

function expiryChip(
  iso: string | null,
  label: string,
  warnDays: number,
  now: number
): { label: string; tone: ChipTone } | null {
  const days = daysUntil(iso, now);
  if (days === null) return null;
  if (days < 0) return { label: `${label} expired`, tone: "danger" };
  if (days <= warnDays) return { label: `${label} ${days}d`, tone: "warn" };
  return { label: `${label} ${days}d`, tone: "ok" };
}

function relativeLabel(iso: string, now: number): string {
  const diff = now - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type SiteRow = {
  id: string;
  url: string;
  label: string | null;
  monitoring_enabled: boolean;
  check_interval_minutes: number;
  // Optional: only the Sites page (which owns the edit form) selects these; the
  // Overview reuse of buildSiteView doesn't need them.
  gsc_property?: string | null;
  ga4_property?: string | null;
};

type CheckRow = {
  status: string;
  http_status: number | null;
  response_ms: number | null;
  ssl_expiry: string | null;
  domain_expiry: string | null;
  checked_at: string;
};

export function buildSiteView(
  site: SiteRow,
  check: CheckRow | null,
  now: number
): SiteView {
  return {
    id: site.id,
    url: site.url,
    label: site.label,
    hostname: hostnameFromUrl(site.url),
    monitoringEnabled: site.monitoring_enabled,
    checkIntervalMinutes: site.check_interval_minutes,
    gscProperty: site.gsc_property ?? null,
    ga4Property: site.ga4_property ?? null,
    check: check
      ? {
          status: check.status === "down" ? "down" : "up",
          statusTone: check.status === "down" ? "danger" : "ok",
          httpStatus: check.http_status,
          responseMs: check.response_ms,
          ssl: expiryChip(check.ssl_expiry, "SSL", SSL_WARN_DAYS, now),
          domain: expiryChip(check.domain_expiry, "Domain", DOMAIN_WARN_DAYS, now),
          checkedAtLabel: relativeLabel(check.checked_at, now),
        }
      : null,
  };
}

// Single-sourced risk assessment for a site's latest check, used by both the
// Sites tab and the monitoring board so they always agree. Same thresholds as
// above (down/expired = red; SSL <= 14d or domain <= 30d = amber; else green).
// A null domain_expiry is unknown and never counts as at-risk.
export type SiteRiskLevel = "down" | "expired" | "at-risk" | "healthy" | "unknown";

export type SiteRisk = {
  level: SiteRiskLevel;
  tone: ChipTone;
  issue: string | null; // worst-issue label for the board's Needs attention
  sortRank: number; // 0 down, 1 expired, 2 at-risk, 3 healthy, 4 unknown
  soonestDays: number | null; // secondary sort key within a rank
  sslDays: number | null;
  domainDays: number | null;
};

function daysLabel(prefix: string, days: number): string {
  return `${prefix} ${days} day${days === 1 ? "" : "s"}`;
}

export function assessSite(
  check: {
    status: string;
    ssl_expiry: string | null;
    domain_expiry: string | null;
  } | null,
  now: number
): SiteRisk {
  if (!check) {
    return {
      level: "unknown",
      tone: "muted",
      issue: null,
      sortRank: 4,
      soonestDays: null,
      sslDays: null,
      domainDays: null,
    };
  }

  const sslDays = daysUntil(check.ssl_expiry, now);
  const domainDays = daysUntil(check.domain_expiry, now);

  if (check.status === "down") {
    return {
      level: "down",
      tone: "danger",
      issue: "Down",
      sortRank: 0,
      soonestDays: null,
      sslDays,
      domainDays,
    };
  }

  const sslExpired = sslDays !== null && sslDays < 0;
  const domainExpired = domainDays !== null && domainDays < 0;
  if (sslExpired || domainExpired) {
    return {
      level: "expired",
      tone: "danger",
      issue: sslExpired ? "SSL expired" : "Domain expired",
      sortRank: 1,
      soonestDays: sslExpired ? sslDays : domainDays,
      sslDays,
      domainDays,
    };
  }

  const candidates: { label: string; days: number }[] = [];
  if (sslDays !== null && sslDays <= SSL_WARN_DAYS) {
    candidates.push({ label: daysLabel("SSL", sslDays), days: sslDays });
  }
  if (domainDays !== null && domainDays <= DOMAIN_WARN_DAYS) {
    candidates.push({ label: daysLabel("Domain", domainDays), days: domainDays });
  }
  if (candidates.length) {
    candidates.sort((a, b) => a.days - b.days);
    return {
      level: "at-risk",
      tone: "warn",
      issue: candidates[0].label,
      sortRank: 2,
      soonestDays: candidates[0].days,
      sslDays,
      domainDays,
    };
  }

  return {
    level: "healthy",
    tone: "ok",
    issue: null,
    sortRank: 3,
    soonestDays: null,
    sslDays,
    domainDays,
  };
}
