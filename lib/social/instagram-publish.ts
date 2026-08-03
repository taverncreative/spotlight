import { PublishError, classifyMetaError } from "./publish-errors.ts";

// Instagram container-publish orchestration (Slice 20f), plugged into the proven
// 20e engine via publisher.ts. Pure and transport-injected (no "server-only", no
// path aliases) so the Graph layer can be mocked in fixture tests.
//
// IG has no binary upload: every item is referenced by a public URL, and
// publishing is a two-phase container flow — create a media container, wait for
// it to finish processing, then media_publish it. A carousel creates one child
// container per image, then a parent CAROUSEL container referencing the children.
//
// THE WAIT IS SPLIT IN TWO, and that is the substance of Reels support. An image
// container finishes in a few seconds, so a short in-request poll has always
// been enough. A Reel does not: Meta's own guidance is to poll for up to five
// minutes, and blocking a cron request that long is not a wait, it is a hostage
// situation.
//
// So: create the container and hand its id back immediately. The caller stores
// it, polls briefly for the common fast case, and if it is not ready returns
// PENDING — a classification that means "look again next tick" and that
// deliberately does not spend a retry. The stored id is what stops the next tick
// creating a second container for the same post, which would spend Instagram's
// 100-posts-per-24-hours limit on containers nobody publishes.

export type IgDeps = {
  graphUrl: (path: string) => string;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  maxPolls: number;
  pollDelayMs: number;
};

export const IG_MAX_CAROUSEL = 10;

async function parseIg(res: Response): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON body
  }
  if (!res.ok || (body && "error" in body)) {
    const message =
      (body as { error?: { message?: string } })?.error?.message ??
      `Instagram Graph request failed (${res.status}).`;
    throw new PublishError(message, classifyMetaError(res.status, body));
  }
  return body ?? {};
}

async function igPost(
  deps: IgDeps,
  path: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const res = await deps.fetchImpl(deps.graphUrl(path), {
    method: "POST",
    body: new URLSearchParams(params),
  });
  return parseIg(res);
}

// One status read. FINISHED -> ready; ERROR/EXPIRED -> terminal, and the caller
// must forget the container id because polling a dead one forever is the failure
// mode this whole design exists to avoid.
export type ContainerStatus = "ready" | "processing";

export async function readContainerStatus(
  deps: IgDeps,
  token: string,
  creationId: string
): Promise<ContainerStatus> {
  const res = await deps.fetchImpl(
    deps.graphUrl(
      `/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`
    )
  );
  const json = await parseIg(res);
  const status = String(json.status_code ?? "");
  if (status === "FINISHED" || status === "PUBLISHED") return "ready";
  if (status === "ERROR" || status === "EXPIRED") {
    throw new PublishError(
      `Instagram media processing failed (${status}).`,
      "validation"
    );
  }
  return "processing";
}

// Bounded poll for the fast case: an image container is usually FINISHED within
// a couple of seconds, and making that wait a whole cron tick would turn a
// working feature into a slower one. Anything still processing after the budget
// raises PENDING and is picked up next tick.
async function waitForContainer(
  deps: IgDeps,
  token: string,
  creationId: string
): Promise<void> {
  for (let i = 0; i < deps.maxPolls; i++) {
    if ((await readContainerStatus(deps, token, creationId)) === "ready")
      return;
    if (i < deps.maxPolls - 1) await deps.sleep(deps.pollDelayMs);
  }
  throw new PublishError(
    "Instagram is still processing this; will check again shortly.",
    "pending"
  );
}

// Publish to one Instagram account. Returns the published media id.
// One item as the container API sees it. The publisher already knows each row's
// media_type; passing it through means this module never has to guess a format
// from a file extension.
export type IgItem = { url: string; isVideo: boolean };

// Create the container and return its id. No waiting here on purpose: the caller
// stores the id BEFORE any wait, so a process that dies mid-poll leaves an id to
// resume from rather than an orphan container and a fresh one next tick.
export async function createInstagramContainer(
  deps: IgDeps,
  igUserId: string,
  token: string,
  caption: string,
  items: IgItem[]
): Promise<string> {
  if (items.length === 0) {
    throw new PublishError("No media to publish.", "validation");
  }
  if (items.length > IG_MAX_CAROUSEL) {
    throw new PublishError(
      `Instagram supports up to ${IG_MAX_CAROUSEL} items per post.`,
      "validation"
    );
  }

  const videos = items.filter((item) => item.isVideo).length;

  // A single video is a REEL. Instagram stopped accepting plain feed video from
  // the API -- video posts become Reels -- so this is the only shape a lone video
  // can take, and naming it REELS is describing what happens rather than
  // choosing it.
  if (items.length === 1 && videos === 1) {
    const created = await igPost(deps, `/${igUserId}/media`, {
      media_type: "REELS",
      video_url: items[0].url,
      caption,
      access_token: token,
    });
    return String(created.id);
  }

  // A carousel MAY mix video and images, but each video child needs its own
  // media_type and the whole thing needs its own testing. Refused clearly rather
  // than attempted and half-working: a validation error names the problem, where
  // a wrong container shape produces a Graph error that says nothing useful.
  if (videos > 0) {
    throw new PublishError(
      "A post can be one video, or up to 10 photos. Mixed carousels are not supported yet.",
      "validation"
    );
  }

  if (items.length === 1) {
    const created = await igPost(deps, `/${igUserId}/media`, {
      image_url: items[0].url,
      caption,
      access_token: token,
    });
    return String(created.id);
  }

  // Carousel: every child container first (in order), then the parent.
  const childIds: string[] = [];
  for (const item of items) {
    const child = await igPost(deps, `/${igUserId}/media`, {
      image_url: item.url,
      is_carousel_item: "true",
      access_token: token,
    });
    childIds.push(String(child.id));
  }
  const parent = await igPost(deps, `/${igUserId}/media`, {
    media_type: "CAROUSEL",
    children: childIds.join(","),
    caption,
    access_token: token,
  });
  return String(parent.id);
}

// Wait for a container and publish it. Split from creation so a caller holding a
// stored container id can resume here without creating anything.
export async function finishInstagramContainer(
  deps: IgDeps,
  igUserId: string,
  token: string,
  creationId: string
): Promise<string> {
  await waitForContainer(deps, token, creationId);
  const published = await igPost(deps, `/${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: token,
  });
  return String(published.id);
}
