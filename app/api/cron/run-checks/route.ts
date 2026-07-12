import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkSite, type CheckResult } from "@/lib/sites/checker";

// The unattended check-runner. Service-role and secret-guarded; it runs the same
// engine as the operator-facing Check now/all over every operator's due sites.
// It is mechanism-agnostic: no schedule is configured here. The scheduled
// trigger (e.g. Vercel Cron) is wired at deploy and calls this with the
// CRON_SECRET bearer. Both GET and POST are accepted so any trigger works.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Constant-time, length-safe comparison via fixed-width SHA-256 digests.
function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const PER_SITE_CAP_MS = 15_000;
const TIMED_OUT: CheckResult = {
  status: "down",
  http_status: null,
  response_ms: null,
  ssl_expiry: null,
  domain_expiry: null,
};

function withCap(
  promise: Promise<CheckResult>,
  ms: number
): Promise<CheckResult> {
  return Promise.race([
    promise,
    new Promise<CheckResult>((resolve) => {
      setTimeout(() => resolve(TIMED_OUT), ms);
    }),
  ]);
}

type SiteRow = {
  id: string;
  url: string;
  monitoring_enabled: boolean;
  check_interval_minutes: number;
  site_checks: { checked_at: string }[];
};

async function handler(request: Request) {
  const secret = process.env.CRON_SECRET;
  // Reject a missing or empty secret outright; never run unauthenticated.
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 401 }
    );
  }
  const provided = request.headers.get("authorization") ?? "";
  if (!secretMatches(provided, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Service role: reads and writes across all operators; site_checks scope is
  // inherent via site_id (no operator_id column).
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("sites")
    .select(
      "id, url, monitoring_enabled, check_interval_minutes, site_checks(checked_at)"
    )
    .order("checked_at", { referencedTable: "site_checks", ascending: false })
    .limit(1, { referencedTable: "site_checks" });
  if (error) {
    return NextResponse.json(
      { error: "Could not load sites" },
      { status: 500 }
    );
  }

  const sites = (data ?? []) as SiteRow[];
  const now = Date.now();

  // Due = monitoring on AND (never checked OR last check + interval has elapsed).
  // Not-due and monitoring-disabled sites are skipped.
  const due = sites.filter((site) => {
    if (!site.monitoring_enabled) return false;
    const latest = site.site_checks?.[0];
    if (!latest) return true;
    const nextDue =
      new Date(latest.checked_at).getTime() +
      site.check_interval_minutes * 60_000;
    return nextDue <= now;
  });

  await Promise.allSettled(
    due.map(async (site) => {
      const result = await withCap(checkSite(site.url), PER_SITE_CAP_MS);
      await supabase.from("site_checks").insert({
        site_id: site.id,
        status: result.status,
        http_status: result.http_status,
        response_ms: result.response_ms,
        ssl_expiry: result.ssl_expiry,
        domain_expiry: result.domain_expiry,
      });
    })
  );

  return NextResponse.json({
    checked: due.length,
    skipped: sites.length - due.length,
  });
}

export const GET = handler;
export const POST = handler;
