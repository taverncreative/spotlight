import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/oauth/encryption";
import { fetchInsights } from "@/lib/social/insights";
import {
  INSIGHTS_BATCH,
  INSIGHTS_WINDOW_DAYS,
} from "@/lib/social/insights-fields";

// Refreshes engagement counts for recently published social posts.
//
// Service-role and secret-guarded, mirroring run-publisher and run-checks. Runs
// unattended, so it is deliberately the most boring worker here: it only READS
// from Meta and only writes to one table it owns. It cannot publish, cannot
// delete, and a total failure leaves stale numbers rather than a wrong action.
//
// SERVICE ROLE because there is no operator session on a cron. Same reasoning as
// the deploy-hook write-back.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

type TargetRow = {
  id: string;
  platform_post_id: string | null;
  published_at: string | null;
  social_accounts: { platform: string; access_token: string | null } | null;
  social_post_insights: { fetched_at: string | null }[] | null;
};

async function handler(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 401 }
    );
  }
  if (
    !secretMatches(
      request.headers.get("authorization") ?? "",
      `Bearer ${secret}`
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const cutoff = new Date(
    Date.now() - INSIGHTS_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("social_post_targets")
    .select(
      "id, platform_post_id, published_at, social_accounts(platform, access_token), social_post_insights(fetched_at)"
    )
    .not("platform_post_id", "is", null)
    .gte("published_at", cutoff);
  if (error) {
    return NextResponse.json(
      { error: "Could not load targets" },
      { status: 500 }
    );
  }

  // Oldest-refreshed first, never-refreshed before everything, so a backlog
  // drains evenly instead of one target being re-read every run.
  const targets = ((data ?? []) as unknown as TargetRow[])
    .slice()
    .sort((a, b) => {
      const at = a.social_post_insights?.[0]?.fetched_at ?? "";
      const bt = b.social_post_insights?.[0]?.fetched_at ?? "";
      return at.localeCompare(bt);
    })
    .slice(0, INSIGHTS_BATCH);

  let refreshed = 0;
  let failed = 0;

  for (const target of targets) {
    const platform = target.social_accounts?.platform;
    const encrypted = target.social_accounts?.access_token;
    if (!platform || !encrypted || !target.platform_post_id) continue;

    let token: string;
    try {
      token = decryptToken(encrypted);
    } catch {
      // A token this app cannot decrypt is an operational fault worth recording
      // against the row, but never worth logging the payload of.
      failed++;
      await supabase.from("social_post_insights").upsert(
        {
          target_id: target.id,
          last_error: "Stored token could not be decrypted.",
        },
        { onConflict: "target_id" }
      );
      continue;
    }

    const result = await fetchInsights(
      platform,
      target.platform_post_id,
      token
    );

    if (!result.ok) {
      failed++;
      // Counts are NOT written on failure: leaving the previous numbers in place
      // is more honest than replacing them with nulls, which would read as "we
      // are not permitted this" rather than "this refresh did not work".
      await supabase
        .from("social_post_insights")
        .upsert(
          { target_id: target.id, last_error: result.error },
          { onConflict: "target_id" }
        );
      continue;
    }

    refreshed++;
    await supabase.from("social_post_insights").upsert(
      {
        target_id: target.id,
        likes: result.insights.likes,
        comments: result.insights.comments,
        shares: result.insights.shares,
        raw: result.insights.raw,
        fetched_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: "target_id" }
    );
  }

  return NextResponse.json({
    considered: targets.length,
    refreshed,
    failed,
  });
}

export const GET = handler;
export const POST = handler;
