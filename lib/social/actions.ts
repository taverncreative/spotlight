"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { reapSocialMedia } from "@/lib/social/media-paths";
import { SOCIAL_MEDIA_BUCKET } from "@/lib/social/schemas";
import { publishPost } from "@/lib/social/publisher";
import type { SocialPostFormState, SocialMediaItem } from "@/lib/social/schemas";

// All actions are owns_client / owns_social_post scoped via RLS (the policies in
// 0020/0022/0026), so a post or its media can only ever be written for a client
// the operator owns.

// The offset (minutes) of Europe/London at the given instant: +60 in BST, 0 in
// GMT. Computed by formatting the instant in the London zone and diffing.
function londonOffsetMinutes(date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const asIfUtc = Date.UTC(
    +p.year,
    +p.month - 1,
    +p.day,
    +p.hour,
    +p.minute
  );
  return Math.round((asIfUtc - date.getTime()) / 60000);
}

// Interpret a date (YYYY-MM-DD) + time (HH:MM) as Europe/London wall-clock and
// return the UTC ISO instant, or null if either part is missing/invalid.
function londonToUtcISO(dateStr: string, timeStr: string): string | null {
  if (!dateStr || !timeStr) return null;
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) return null;
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const offset = londonOffsetMinutes(new Date(asUtc));
  return new Date(asUtc - offset * 60000).toISOString();
}

function parseMedia(raw: string): SocialMediaItem[] {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((m) => m && typeof m.storage_path === "string")
      .map((m) => ({
        storage_path: m.storage_path as string,
        media_type: m.media_type === "video" ? "video" : "image",
        width: typeof m.width === "number" ? m.width : null,
        height: typeof m.height === "number" ? m.height : null,
      }));
  } catch {
    return [];
  }
}

// Save a social post (create or edit; draft or schedule). The post id is
// generated client-side so media can upload to its storage path before save;
// new posts insert, edits update (both RLS-scoped). Media rows are replaced from
// the submitted list with contiguous 0-based positions, and any objects no
// longer referenced are reaped (best-effort).
export async function saveSocialPost(
  _previous: SocialPostFormState,
  formData: FormData
): Promise<SocialPostFormState> {
  const id = String(formData.get("id") ?? "");
  const clientId = String(formData.get("client_id") ?? "");
  const clientSlug = String(formData.get("client_slug") ?? "");
  const mode = String(formData.get("mode") ?? "new"); // new | edit
  const intent = String(formData.get("intent") ?? "draft"); // draft | schedule | publish
  const caption = String(formData.get("caption") ?? "");
  const media = parseMedia(String(formData.get("media") ?? "[]"));
  const selectedTargets = formData.getAll("target").map(String).filter(Boolean);
  if (!id || !clientId || !clientSlug) {
    return { ok: false, error: "Missing post or client." };
  }

  // The schedule time comes straight from the date/time inputs (interpreted as
  // Europe/London). A draft is never scheduled, so it stores null regardless.
  const scheduledAt = londonToUtcISO(
    String(formData.get("schedule_date") ?? ""),
    String(formData.get("schedule_time") ?? "")
  );

  if (intent === "schedule") {
    if (media.length === 0) {
      return {
        ok: false,
        fieldErrors: { media: ["Add at least one photo to schedule."] },
      };
    }
    if (!scheduledAt) {
      return {
        ok: false,
        fieldErrors: { schedule: ["Choose a date and time to schedule."] },
      };
    }
    if (new Date(scheduledAt).getTime() <= Date.now()) {
      return {
        ok: false,
        fieldErrors: { schedule: ["The scheduled time must be in the future."] },
      };
    }
  }

  if (intent === "publish") {
    if (media.length === 0) {
      return {
        ok: false,
        fieldErrors: { media: ["Add at least one photo to publish."] },
      };
    }
    if (selectedTargets.length === 0) {
      return {
        ok: false,
        fieldErrors: { targets: ["Choose at least one account to publish to."] },
      };
    }
  }

  const status = intent === "schedule" ? "scheduled" : "draft";
  const storedScheduledAt = intent === "schedule" ? scheduledAt : null;
  const supabase = await createClient();

  if (mode === "edit") {
    const { data, error } = await supabase
      .from("social_posts")
      .update({ caption, status, scheduled_at: storedScheduledAt })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error || !data) return { ok: false, error: "Could not save the post." };
  } else {
    const { error } = await supabase.from("social_posts").insert({
      id,
      client_id: clientId,
      caption,
      status,
      scheduled_at: storedScheduledAt,
    });
    if (error) return { ok: false, error: "Could not save the post." };
  }

  // Replace media rows from the submitted list. Reap objects that are no longer
  // referenced (removed items), then rewrite the rows with contiguous positions.
  const { data: existing } = await supabase
    .from("social_post_media")
    .select("storage_path")
    .eq("post_id", id);
  const submitted = new Set(media.map((m) => m.storage_path));
  const orphans = (existing ?? [])
    .map((r) => r.storage_path as string)
    .filter((p) => !submitted.has(p));
  await reapSocialMedia(supabase, orphans);

  await supabase.from("social_post_media").delete().eq("post_id", id);
  if (media.length > 0) {
    const rows = media.map((m, index) => ({
      post_id: id,
      position: index,
      storage_path: m.storage_path,
      media_type: m.media_type,
      width: m.width,
      height: m.height,
    }));
    const { error: mediaError } = await supabase
      .from("social_post_media")
      .insert(rows);
    if (mediaError) return { ok: false, error: "Could not save the photos." };
  }

  // Reconcile targets to exactly the selected set, preserving the publish results
  // (platform_post_id / published_at) on targets that stay. RLS (owns_social_post)
  // scopes these writes to the operator's own post.
  const { data: existingTargets } = await supabase
    .from("social_post_targets")
    .select("id, meta_account_id")
    .eq("post_id", id);
  const selectedSet = new Set(selectedTargets);
  const existingByAccount = new Map(
    (existingTargets ?? []).map((t) => [
      t.meta_account_id as string,
      t.id as string,
    ])
  );
  const removeIds = (existingTargets ?? [])
    .filter((t) => !selectedSet.has(t.meta_account_id as string))
    .map((t) => t.id as string);
  if (removeIds.length > 0) {
    await supabase.from("social_post_targets").delete().in("id", removeIds);
  }
  const addRows = selectedTargets
    .filter((mid) => !existingByAccount.has(mid))
    .map((mid) => ({ post_id: id, meta_account_id: mid }));
  if (addRows.length > 0) {
    await supabase.from("social_post_targets").insert(addRows);
  }

  // Publish now: take it live immediately through the same engine the cron uses.
  if (intent === "publish") {
    await publishPost(supabase, id);
  }

  redirect(`/c/${clientSlug}/social`);
}

// Delete a post (cascades media + targets), then reap its storage objects
// (best-effort; the post is already gone).
export async function deleteSocialPost(
  _previous: SocialPostFormState,
  formData: FormData
): Promise<SocialPostFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing post id." };
  const supabase = await createClient();

  // Capture the client before deleting, to reap the whole post folder after.
  const { data: post } = await supabase
    .from("social_posts")
    .select("client_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("social_posts").delete().eq("id", id);
  if (error) return { ok: false, error: "Could not delete the post." };

  // Reap the entire {client_id}/{post_id}/ folder — media-row objects and any
  // abandoned uploads alike. Best-effort: a storage failure never blocks the
  // delete (the post is already gone).
  if (post) {
    const folder = `${post.client_id as string}/${id}`;
    try {
      const { data: objects } = await supabase.storage
        .from(SOCIAL_MEDIA_BUCKET)
        .list(folder);
      await reapSocialMedia(
        supabase,
        (objects ?? []).map((o) => `${folder}/${o.name}`)
      );
    } catch {
      // best-effort
    }
  }

  return { ok: true };
}
