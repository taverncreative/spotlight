import "server-only";
import { createClient } from "@/lib/supabase/server";
import { londonParts } from "@/lib/social/london";

// What time does this client normally post?
//
// DERIVED, NOT STORED. The obvious implementation is a default_post_time column
// on clients plus a settings field to maintain it, and that is one more thing to
// keep in step with the truth. The truth is already in the data: every social
// post carries the time it was scheduled for.
//
// Measured before building it. Across every scheduled post in production,
// TavernCreative is 46/46 at 13:00 London and Business Sorted Kent 16/16 at
// 13:00. A per-client habit, held perfectly, and never once typed differently --
// which is exactly the case for reading it back rather than asking for it.
//
// MOST RECENT rather than most common. A habit that changes should take effect
// from the next post, not once it has outvoted a year of history.
export async function lastScheduledTime(
  clientId: string
): Promise<string | null> {
  const supabase = await createClient();
  // RLS scopes social_posts to the operator, so this can only ever read a
  // client they own.
  const { data } = await supabase
    .from("social_posts")
    .select("scheduled_at")
    .eq("client_id", clientId)
    .not("scheduled_at", "is", null)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const scheduledAt = (data as { scheduled_at: string | null } | null)
    ?.scheduled_at;
  if (!scheduledAt) return null;

  // London wall clock, matching what the composer's time input displays and
  // what saveSocialPost converts back from. A post stored at 12:00Z reads as
  // 13:00 through the summer and 12:00 through the winter, and the operator
  // types the London time in both cases.
  return londonParts(scheduledAt).time;
}
