import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  publishPost,
  STALE_RECLAIM_MINUTES,
  CLAIM_BATCH,
} from "@/lib/social/publisher";

// The unattended publisher. Service-role and secret-guarded, mirroring
// run-checks: it claims due scheduled posts (and stale 'publishing' posts, for
// crash recovery) atomically via claim_due_social_posts (FOR UPDATE SKIP LOCKED),
// then runs the shared engine over each. Mechanism-agnostic: the schedule is
// wired at deploy and calls this with the CRON_SECRET bearer. Both GET and POST.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secretMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

async function handler(request: Request) {
  const secret = process.env.CRON_SECRET;
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

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("claim_due_social_posts", {
    p_stale_minutes: STALE_RECLAIM_MINUTES,
    p_limit: CLAIM_BATCH,
  });
  if (error) {
    return NextResponse.json(
      { error: "Could not claim posts" },
      { status: 500 }
    );
  }

  // setof uuid comes back as an array of scalars or single-key rows depending on
  // the PostgREST shape; normalise to ids.
  const claimed: string[] = (data ?? []).map((row: unknown) =>
    typeof row === "string" ? row : String(Object.values(row as object)[0])
  );

  await Promise.allSettled(claimed.map((id) => publishPost(supabase, id)));

  return NextResponse.json({ claimed: claimed.length });
}

export const GET = handler;
export const POST = handler;
