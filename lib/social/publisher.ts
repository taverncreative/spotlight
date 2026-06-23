import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken } from "@/lib/oauth/encryption";
import { graphUrl } from "@/lib/oauth/meta";
import { SOCIAL_MEDIA_BUCKET } from "@/lib/social/schemas";
import { socialMediaPublicUrl } from "@/lib/social/media-paths";
import {
  publishInstagramContainer,
  type IgDeps,
} from "@/lib/social/instagram-publish";
import {
  PublishError,
  classifyMetaError,
  type ErrorClass,
} from "@/lib/social/publish-errors";

export { classifyMetaError, type ErrorClass } from "@/lib/social/publish-errors";

// The publisher engine — the single source of truth for taking a social post
// live. Both the unattended cron (run-publisher) and the operator's "Publish now"
// call publishPost(); it is platform-agnostic, fans out per target, and is the
// one place that decides a post's terminal status.
//
// Safety guarantees (see Slice 20e):
//   * Idempotency: a target with a platform_post_id is never re-published.
//   * Interruption safety: attempt_started_at is stamped immediately BEFORE the
//     Graph call and cleared on a clean failure. A target found with
//     attempt_started_at set but no platform_post_id was interrupted mid-publish
//     and is NEVER auto-reposted — it is flagged for manual verification.

export const MAX_ATTEMPTS = 3;
export const STALE_RECLAIM_MINUTES = 10;
export const CLAIM_BATCH = 20;

type MediaRow = {
  position: number;
  storage_path: string;
  media_type: "image" | "video";
  width: number | null;
  height: number | null;
};

type AccountRow = {
  id: string;
  platform: string;
  external_id: string;
  access_token: string | null;
  parent_account_id: string | null;
};

type TargetRow = {
  id: string;
  meta_account_id: string;
  platform_post_id: string | null;
  attempt_started_at: string | null;
  meta_accounts: AccountRow | null;
};

type PostRow = {
  id: string;
  caption: string;
  attempts: number;
  social_post_media: MediaRow[];
  social_post_targets: TargetRow[];
};

export type PublishSummary = {
  postId: string;
  status: string;
  published: number;
  failed: number;
  interrupted: number;
  skipped: number;
};

// Read an image's bytes from the social-media bucket. The public URL points at
// 127.0.0.1, which Facebook can't reach, so we always upload the binary.
async function downloadMedia(
  supabase: SupabaseClient,
  storagePath: string
): Promise<Blob> {
  const { data, error } = await supabase.storage
    .from(SOCIAL_MEDIA_BUCKET)
    .download(storagePath);
  if (error || !data) {
    throw new PublishError(`Could not read media (${storagePath}).`, "validation");
  }
  return data;
}

// Parse a Graph response, throwing a classified PublishError on any error.
async function parseGraph(res: Response): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON body
  }
  if (!res.ok || (body && "error" in body)) {
    const message =
      (body as { error?: { message?: string } })?.error?.message ??
      `Graph request failed (${res.status}).`;
    throw new PublishError(message, classifyMetaError(res.status, body));
  }
  return body ?? {};
}

// Publish one Facebook target: single photo to /{page}/photos, or a carousel as
// unpublished /{page}/photos then a /{page}/feed post referencing them. Returns
// the platform post id.
async function publishFacebookTarget(
  supabase: SupabaseClient,
  account: AccountRow,
  caption: string,
  media: MediaRow[]
): Promise<string> {
  if (!account.access_token) {
    throw new PublishError("No stored token for this Page.", "auth");
  }
  let pageToken: string;
  try {
    pageToken = decryptToken(account.access_token);
  } catch {
    // An unreadable/corrupted stored token means the connection is broken.
    throw new PublishError(
      "Stored token could not be read; reconnect needed.",
      "auth"
    );
  }
  const pageId = account.external_id;
  if (media.length === 0) {
    throw new PublishError("No media to publish.", "validation");
  }

  if (media.length === 1) {
    const blob = await downloadMedia(supabase, media[0].storage_path);
    const form = new FormData();
    form.append("source", blob, "photo");
    form.append("caption", caption);
    form.append("access_token", pageToken);
    const res = await fetch(graphUrl(`/${pageId}/photos`), {
      method: "POST",
      body: form,
    });
    const json = await parseGraph(res);
    return String(json.post_id ?? json.id);
  }

  // Carousel: upload each photo unpublished to collect media_fbids, then feed.
  const mediaFbids: string[] = [];
  for (const m of media) {
    const blob = await downloadMedia(supabase, m.storage_path);
    const form = new FormData();
    form.append("source", blob, "photo");
    form.append("published", "false");
    form.append("access_token", pageToken);
    const res = await fetch(graphUrl(`/${pageId}/photos`), {
      method: "POST",
      body: form,
    });
    const json = await parseGraph(res);
    mediaFbids.push(String(json.id));
  }
  const feed = new FormData();
  feed.append("message", caption);
  mediaFbids.forEach((id, i) =>
    feed.append(`attached_media[${i}]`, JSON.stringify({ media_fbid: id }))
  );
  feed.append("access_token", pageToken);
  const res = await fetch(graphUrl(`/${pageId}/feed`), {
    method: "POST",
    body: feed,
  });
  const json = await parseGraph(res);
  return String(json.id);
}

// Instagram uses a public-URL container flow (no binary upload) with a bounded
// processing poll: up to 5 polls ~2s apart before returning transient.
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const IG_DEPS: IgDeps = {
  graphUrl,
  fetchImpl: fetch,
  sleep,
  maxPolls: 5,
  pollDelayMs: 2000,
};

async function flagParentReconnect(
  supabase: SupabaseClient,
  parentId: string
): Promise<void> {
  await supabase
    .from("meta_accounts")
    .update({ needs_reconnect: true })
    .eq("id", parentId);
}

// Publish one Instagram target. The IG row publishes through its linked Page, so
// it borrows the parent Page's token (resolved via parent_account_id); the IG
// row's own external_id is the IG user id. Auth failures flag the parent Page for
// reconnect. Returns the published media id.
async function publishInstagramTarget(
  supabase: SupabaseClient,
  account: AccountRow,
  caption: string,
  media: MediaRow[]
): Promise<string> {
  const parentId = account.parent_account_id;
  if (!parentId) {
    throw new PublishError(
      "Instagram account has no linked Facebook Page; reconnect Meta.",
      "validation"
    );
  }

  const { data: parent } = await supabase
    .from("meta_accounts")
    .select("external_id, access_token")
    .eq("id", parentId)
    .maybeSingle();
  if (!parent || !parent.access_token) {
    throw new PublishError(
      "Linked Facebook Page not found; reconnect Meta.",
      "validation"
    );
  }

  let pageToken: string;
  try {
    pageToken = decryptToken(parent.access_token as string);
  } catch {
    await flagParentReconnect(supabase, parentId);
    throw new PublishError(
      "Stored Page token could not be read; reconnect needed.",
      "auth"
    );
  }

  // IG fetches each image from its public URL (deploy-gated; 127.0.0.1 locally).
  const mediaUrls = media.map((m) => socialMediaPublicUrl(m.storage_path));
  try {
    return await publishInstagramContainer(
      IG_DEPS,
      account.external_id,
      pageToken,
      caption,
      mediaUrls
    );
  } catch (e) {
    if (e instanceof PublishError && e.classification === "auth") {
      await flagParentReconnect(supabase, parentId);
    }
    throw e;
  }
}

// Platform dispatch table. Each branch is the platform path only; the engine
// around it (idempotency, status machine, retries, classification) is shared.
async function publishTarget(
  supabase: SupabaseClient,
  account: AccountRow,
  caption: string,
  media: MediaRow[]
): Promise<string> {
  if (account.platform === "facebook") {
    return publishFacebookTarget(supabase, account, caption, media);
  }
  if (account.platform === "instagram") {
    return publishInstagramTarget(supabase, account, caption, media);
  }
  throw new PublishError(
    `Unsupported platform: ${account.platform}.`,
    "validation"
  );
}

// Publish a single post. Loads it with its ordered media and its targets (each
// joined to its meta_account), publishes every not-yet-published target, and
// settles the post's terminal status. Increments attempts once per call.
export async function publishPost(
  supabase: SupabaseClient,
  postId: string
): Promise<PublishSummary> {
  const { data, error } = await supabase
    .from("social_posts")
    .select(
      "id, caption, attempts, social_post_media(position, storage_path, media_type, width, height), social_post_targets(id, meta_account_id, platform_post_id, attempt_started_at, meta_accounts(id, platform, external_id, access_token, parent_account_id))"
    )
    .eq("id", postId)
    .maybeSingle();
  if (error || !data) {
    return {
      postId,
      status: "failed",
      published: 0,
      failed: 0,
      interrupted: 0,
      skipped: 0,
    };
  }
  const post = data as unknown as PostRow;
  const attempts = (post.attempts ?? 0) + 1;

  // Claim/mark publishing for this run and count the attempt (one place, both
  // the cron and Publish-now paths).
  await supabase
    .from("social_posts")
    .update({
      status: "publishing",
      claimed_at: new Date().toISOString(),
      attempts,
    })
    .eq("id", postId);

  const media = (post.social_post_media ?? [])
    .slice()
    .sort((a, b) => a.position - b.position);
  const targets = post.social_post_targets ?? [];

  let published = 0;
  let interrupted = 0;
  let skipped = 0;
  let sawTransient = false;
  let sawTerminal = false; // auth, validation, or interrupted

  for (const target of targets) {
    // Idempotency: already published -> never touch it again.
    if (target.platform_post_id) {
      skipped += 1;
      continue;
    }

    // Interruption safety: stamped but unrecorded from a prior run -> the process
    // died mid-publish. Never auto-repost; flag for manual verification (label
    // derived from the target's platform — logic unchanged).
    if (target.attempt_started_at) {
      interrupted += 1;
      sawTerminal = true;
      const platformLabel =
        target.meta_accounts?.platform === "instagram"
          ? "Instagram"
          : "Facebook";
      await supabase
        .from("social_post_targets")
        .update({ last_error: `interrupted — verify on ${platformLabel}` })
        .eq("id", target.id);
      continue;
    }

    const account = target.meta_accounts;
    if (!account) {
      sawTerminal = true;
      await supabase
        .from("social_post_targets")
        .update({ last_error: "Account no longer connected." })
        .eq("id", target.id);
      continue;
    }

    // Stamp immediately before the Graph call; clear any prior error.
    await supabase
      .from("social_post_targets")
      .update({ attempt_started_at: new Date().toISOString(), last_error: null })
      .eq("id", target.id);

    try {
      const platformPostId = await publishTarget(
        supabase,
        account,
        post.caption ?? "",
        media
      );
      await supabase
        .from("social_post_targets")
        .update({
          platform_post_id: platformPostId,
          published_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", target.id);
      published += 1;
    } catch (e) {
      const cls: ErrorClass =
        e instanceof PublishError ? e.classification : "transient";
      const message =
        e instanceof Error ? e.message : "Publish failed unexpectedly.";
      if (cls === "auth") {
        await supabase
          .from("meta_accounts")
          .update({ needs_reconnect: true })
          .eq("id", account.id);
      }
      if (cls === "transient") sawTransient = true;
      else sawTerminal = true;
      // Clear the stamp so this is a clean (retryable, if transient) failure,
      // distinguishable from a true interruption.
      await supabase
        .from("social_post_targets")
        .update({ attempt_started_at: null, last_error: message })
        .eq("id", target.id);
    }
  }

  const total = targets.length;
  const allPublished = total > 0 && published + skipped === total;

  let status: string;
  if (allPublished) {
    status = "published";
  } else if (sawTerminal || attempts >= MAX_ATTEMPTS) {
    // Give up now: terminal failure present, or transient retries exhausted.
    status = published + skipped > 0 ? "partial" : "failed";
  } else if (sawTransient) {
    // Only transient failures and attempts remain -> retry next cron tick.
    status = "scheduled";
  } else {
    // No targets at all, or nothing actionable.
    status = total === 0 ? "failed" : "partial";
  }

  const update: Record<string, unknown> = { status };
  if (status === "published") {
    update.published_at = new Date().toISOString();
    update.last_error = null;
  } else if (status === "partial" || status === "failed") {
    update.last_error = `${published + skipped}/${total} targets published.`;
  } else {
    update.last_error = null;
  }
  await supabase.from("social_posts").update(update).eq("id", postId);

  return {
    postId,
    status,
    published,
    failed: total - published - skipped - interrupted,
    interrupted,
    skipped,
  };
}
