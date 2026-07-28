import { PublishError, classifyMetaError } from "./publish-errors.ts";

// Facebook Page Reels: its own integration, not a branch in the Instagram code.
//
// It shares nothing with Instagram's flow but the shape of the problem. Instagram
// creates a container from a URL and polls it. Facebook runs a THREE-PHASE upload
// session across TWO HOSTS:
//
//   1. start     POST graph.facebook.com/{page}/video_reels  -> a video_id
//   2. transfer  POST rupload.facebook.com/video-upload/{v}/{video_id}
//   3. finish    POST graph.facebook.com/{page}/video_reels  -> publishes it
//
// FACEBOOK FETCHES THE FILE ITSELF, via a file_url header on the transfer, and
// that single detail is what keeps this feasible. The documented alternative is
// streaming the bytes with --data-binary, which for a 200 MB Reel would mean
// pulling the whole file into a Vercel lambda and pushing it out again, against
// that function's memory and its duration limit. file_url makes the transfer a
// request Meta acts on rather than a pipe we hold open, exactly as Instagram's
// video_url does.
//
// Pure and transport-injected, like instagram-publish.ts: no "server-only", no
// path aliases, so the Graph layer can be faked in tests.

export type FbDeps = {
  graphUrl: (path: string) => string;
  ruploadUrl: (videoId: string) => string;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  maxPolls: number;
  pollDelayMs: number;
};

// Reels are vertical short-form; Meta rejects anything longer at finish. Checked
// here as well as in the uploader so a post that slipped through as feed-shaped
// gets a sentence rather than a Graph error.
export const FB_REEL_MAX_SECONDS = 90;

async function parseFb(res: Response): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON body
  }
  if (!res.ok || (body && "error" in body)) {
    const message =
      (body as { error?: { message?: string } })?.error?.message ??
      `Facebook request failed (${res.status}).`;
    throw new PublishError(message, classifyMetaError(res.status, body));
  }
  return body ?? {};
}

async function graphPost(
  deps: FbDeps,
  path: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const res = await deps.fetchImpl(deps.graphUrl(path), {
    method: "POST",
    body: new URLSearchParams(params),
  });
  return parseFb(res);
}

// --- phase 1 --------------------------------------------------------------

export async function startReelUpload(
  deps: FbDeps,
  pageId: string,
  token: string
): Promise<string> {
  const body = await graphPost(deps, `/${pageId}/video_reels`, {
    upload_phase: "start",
    access_token: token,
  });
  const videoId = body.video_id ?? body.id;
  if (!videoId) {
    throw new PublishError(
      "Facebook did not return a video id for the upload.",
      "transient"
    );
  }
  return String(videoId);
}

// --- phase 2 --------------------------------------------------------------

// The one call that does not go to graph.facebook.com, and the one that uses an
// OAuth header rather than an access_token parameter. Both are easy to get wrong
// by analogy with every other call in this codebase, which is why they are here
// and not inlined.
export async function transferReel(
  deps: FbDeps,
  videoId: string,
  token: string,
  fileUrl: string
): Promise<void> {
  const res = await deps.fetchImpl(deps.ruploadUrl(videoId), {
    method: "POST",
    headers: {
      Authorization: `OAuth ${token}`,
      // Facebook fetches it. No bytes pass through this process.
      file_url: fileUrl,
    },
  });
  await parseFb(res);
}

// --- phase 3 --------------------------------------------------------------

export async function finishReel(
  deps: FbDeps,
  pageId: string,
  videoId: string,
  token: string,
  description: string
): Promise<void> {
  await graphPost(deps, `/${pageId}/video_reels`, {
    upload_phase: "finish",
    video_id: videoId,
    video_state: "PUBLISHED",
    description,
    access_token: token,
  });
}

// --- status ---------------------------------------------------------------

// Where a video actually is, collapsed from Meta's three phases into the three
// answers a caller can act on.
export type ReelStatus = "published" | "working" | "needs_transfer";

type PhaseShape = { status?: string } | undefined;

export async function readReelStatus(
  deps: FbDeps,
  videoId: string,
  token: string
): Promise<ReelStatus> {
  const res = await deps.fetchImpl(
    deps.graphUrl(
      `/${videoId}?fields=status&access_token=${encodeURIComponent(token)}`
    )
  );
  const body = await parseFb(res);
  const status = (body.status ?? {}) as {
    uploading_phase?: PhaseShape;
    processing_phase?: PhaseShape;
    publishing_phase?: PhaseShape;
    video_status?: string;
  };

  const phase = (p: PhaseShape): string => String(p?.status ?? "").toLowerCase();
  const uploading = phase(status.uploading_phase);
  const processing = phase(status.processing_phase);
  const publishing = phase(status.publishing_phase);

  // An error in ANY phase is terminal: the session is spent and a retry must
  // start a new one rather than poll this corpse.
  for (const [name, value] of [
    ["upload", uploading],
    ["processing", processing],
    ["publishing", publishing],
  ] as const) {
    if (value === "error") {
      throw new PublishError(
        `Facebook Reel ${name} failed.`,
        "validation"
      );
    }
  }

  if (publishing === "complete") return "published";
  // Uploading not finished means the transfer never happened or did not land --
  // the resumable case. Re-issuing it is cheap because Facebook does the
  // fetching; nothing is re-sent from here.
  if (uploading !== "complete") return "needs_transfer";
  return "working";
}

// --- the whole thing ------------------------------------------------------

export type ReelAttempt =
  | { done: true; videoId: string }
  | { done: false; videoId: string };

// Publish a Reel, or pick up where a previous tick left off.
//
// RESUME BY ASKING, NOT BY REMEMBERING. The only thing stored between ticks is
// the video id; which phase to resume at is read back from Meta. Storing our own
// idea of the phase would mean two sources of truth that can disagree, and the
// one that matters is theirs.
export async function publishFacebookReel(
  deps: FbDeps,
  pageId: string,
  token: string,
  description: string,
  fileUrl: string,
  existingVideoId: string | null,
  onVideoId: (videoId: string) => Promise<void>
): Promise<ReelAttempt> {
  let videoId = existingVideoId;

  if (!videoId) {
    videoId = await startReelUpload(deps, pageId, token);
    // Stored BEFORE the transfer, so a process that dies mid-upload leaves a
    // session to resume rather than an abandoned one and a fresh start.
    await onVideoId(videoId);
    await transferReel(deps, videoId, token, fileUrl);
    await finishReel(deps, pageId, videoId, token, description);
  } else {
    // Resuming. Ask where it got to.
    const status = await readReelStatus(deps, videoId, token);
    if (status === "published") return { done: true, videoId };
    if (status === "needs_transfer") {
      await transferReel(deps, videoId, token, fileUrl);
      await finishReel(deps, pageId, videoId, token, description);
    }
  }

  // A short poll for the fast case, then hand back to the cron. Same bargain as
  // Instagram: do not make a quick job wait five minutes, and do not hold a
  // request open for a slow one.
  for (let i = 0; i < deps.maxPolls; i++) {
    if ((await readReelStatus(deps, videoId, token)) === "published") {
      return { done: true, videoId };
    }
    if (i < deps.maxPolls - 1) await deps.sleep(deps.pollDelayMs);
  }

  throw new PublishError(
    "Facebook is still processing this Reel; will check again shortly.",
    "pending"
  );
}
