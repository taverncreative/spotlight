"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { reapSocialMedia } from "@/lib/social/media-paths";
import { postImagePath } from "@/lib/posts/image-paths";
import { londonOffsetMinutes } from "@/lib/social/london";
import { SOCIAL_MEDIA_BUCKET } from "@/lib/social/schemas";
import { publishPost } from "@/lib/social/publisher";
import type {
  SocialPostFormState,
  SocialMediaItem,
} from "@/lib/social/schemas";

// All actions are owns_client / owns_social_post scoped via RLS (the policies in
// 0020/0022/0026), so a post or its media can only ever be written for a client
// the operator owns.

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

  const supabase = await createClient();

  // Photos are mandatory only when an Instagram target is selected: IG has no
  // text-only posts, while a Facebook Page accepts a message-only feed post.
  // The lookup is RLS-scoped, so foreign ids simply resolve to no rows.
  let requiresMedia = false;
  if (selectedTargets.length > 0) {
    const { data: targetAccounts } = await supabase
      .from("meta_accounts")
      .select("id, platform")
      .in("id", selectedTargets);
    requiresMedia = (targetAccounts ?? []).some(
      (account) => account.platform === "instagram"
    );
  }

  if (intent === "schedule" || intent === "publish") {
    if (media.length === 0 && requiresMedia) {
      return {
        ok: false,
        fieldErrors: {
          media: ["Add at least one photo to post to Instagram."],
        },
      };
    }
    // A text-only post still needs a caption, or there is nothing to publish.
    if (media.length === 0 && caption.trim() === "") {
      return {
        ok: false,
        fieldErrors: { media: ["Add a caption or at least one photo."] },
      };
    }
  }

  if (intent === "schedule") {
    if (!scheduledAt) {
      return {
        ok: false,
        fieldErrors: { schedule: ["Choose a date and time to schedule."] },
      };
    }
    if (new Date(scheduledAt).getTime() <= Date.now()) {
      return {
        ok: false,
        fieldErrors: {
          schedule: ["The scheduled time must be in the future."],
        },
      };
    }
  }

  if (intent === "publish") {
    if (selectedTargets.length === 0) {
      return {
        ok: false,
        fieldErrors: {
          targets: ["Choose at least one account to publish to."],
        },
      };
    }
  }

  const status = intent === "schedule" ? "scheduled" : "draft";
  const storedScheduledAt = intent === "schedule" ? scheduledAt : null;

  if (mode === "edit") {
    // Only draft/scheduled posts are editable. The status filter is atomic, so
    // a post the publisher claims mid-edit cannot be overwritten from here.
    const { data, error } = await supabase
      .from("social_posts")
      .update({ caption, status, scheduled_at: storedScheduledAt })
      .eq("id", id)
      .in("status", ["draft", "scheduled"])
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, error: "Could not save the post." };
    if (!data) {
      return {
        ok: false,
        error:
          "This post is publishing or already published and can no longer be edited.",
      };
    }
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

// Cancel a scheduled post back to draft (never deleted). Atomic on status, so
// a post the publisher has already claimed cannot be pulled back mid-publish.
export async function cancelScheduledPost(
  id: string
): Promise<SocialPostFormState> {
  if (!id) return { ok: false, error: "Missing post id." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("social_posts")
    .update({ status: "draft", scheduled_at: null })
    .eq("id", id)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: "Could not cancel the schedule." };
  if (!data) {
    return {
      ok: false,
      error: "This post is no longer scheduled, so there is nothing to cancel.",
    };
  }
  return { ok: true };
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

// Seed a social draft from a published blog post and hand off to the composer.
// A plain form action (from the blog card), so it never surfaces a result: on
// success it redirects into the existing edit page, which reconstructs the
// composer from the saved draft (caption + photo, no targets). The draft is
// created with no targets and status 'draft', so the publisher never claims it
// until John schedules or publishes it from the composer.
export async function shareToSocial(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? ""); // the blog post id
  const clientSlug = String(formData.get("client_slug") ?? "");
  if (!id || !clientSlug) return;

  const supabase = await createClient();

  // Only published posts are shareable, and RLS scopes the read to the operator.
  // The client is embedded (many-to-one, so a single object) for its blog root.
  const { data: post } = await supabase
    .from("posts")
    .select(
      "client_id, title, slug, meta_description, featured_image, status, clients(blog_base_url)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!post || post.status !== "published") return;

  const clientId = post.client_id as string;
  const socialPostId = randomUUID();

  // Caption: the title, the meta description, then the live post link, each on
  // its own line. The link needs the client's blog root, which is only set when
  // we know where their posts live publicly (the /news path is BSK's convention,
  // not a given) — without it the link is simply left out. The stored value is
  // already trailing-slash-stripped, but a row predating that (or edited in the
  // DB) is stripped again here so the join can never double up the slash.
  // clients is many-to-one, so PostgREST returns one object; the select-string
  // parser infers an array without generated DB types, hence the cast (the same
  // `as unknown as` idiom the publisher uses for its nested meta_accounts).
  const client = post.clients as unknown as {
    blog_base_url: string | null;
  } | null;
  const base = (client?.blog_base_url ?? "").trim().replace(/\/+$/, "");
  const slug = (post.slug as string) ?? "";
  const link = base && slug ? `${base}/${slug}` : "";
  const title = (post.title as string) ?? "";
  const meta = ((post.meta_description as string | null) ?? "").trim();
  const caption = [title, meta, link].filter(Boolean).join("\n\n");

  // Seed the draft first so the media-row insert passes owns_social_post RLS,
  // and a copy failure below simply leaves a caption-only draft to edit.
  const { error: insertError } = await supabase.from("social_posts").insert({
    id: socialPostId,
    client_id: clientId,
    caption,
    status: "draft",
    scheduled_at: null,
  });
  if (insertError) return;

  // Copy the featured image bytes from post-images into the social-media bucket
  // under the new post's {client}/{post}/ folder (the layout the uploader and
  // publisher expect). A post with no image under our bucket seeds a
  // caption-only draft; width/height are unknown at copy time, so null.
  const sourceKey = postImagePath(post.featured_image as string | null);
  if (sourceKey) {
    const dot = sourceKey.lastIndexOf(".");
    const ext =
      dot === -1
        ? ""
        : sourceKey
            .slice(dot + 1)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
    const destKey = `${clientId}/${socialPostId}/${randomUUID()}${ext ? `.${ext}` : ""}`;
    const { error: copyError } = await supabase.storage
      .from("post-images")
      .copy(sourceKey, destKey, { destinationBucket: SOCIAL_MEDIA_BUCKET });
    if (!copyError) {
      await supabase.from("social_post_media").insert({
        post_id: socialPostId,
        position: 0,
        storage_path: destKey,
        media_type: "image",
        width: null,
        height: null,
      });
    }
  }

  redirect(`/c/${clientSlug}/social/${socialPostId}/edit`);
}
