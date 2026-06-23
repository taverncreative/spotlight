import { PublishError, classifyMetaError } from "./publish-errors.ts";

// Instagram container-publish orchestration (Slice 20f), plugged into the proven
// 20e engine via publisher.ts. Pure and transport-injected (no "server-only", no
// path aliases) so the Graph layer can be mocked in fixture tests.
//
// IG has no binary upload: every image is referenced by a public image_url, and
// publishing is a two-phase container flow — create a media container, wait for
// it to finish processing, then media_publish it. A carousel creates one child
// container per image, then a parent CAROUSEL container referencing the children.

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

// Bounded poll of a container's processing status. FINISHED -> ready to publish;
// ERROR/EXPIRED -> terminal validation; still in progress after the cap ->
// transient (the engine sends the post back to scheduled for the next cron tick).
async function waitForContainer(
  deps: IgDeps,
  token: string,
  creationId: string
): Promise<void> {
  for (let i = 0; i < deps.maxPolls; i++) {
    const res = await deps.fetchImpl(
      deps.graphUrl(
        `/${creationId}?fields=status_code&access_token=${encodeURIComponent(token)}`
      )
    );
    const json = await parseIg(res);
    const status = String(json.status_code ?? "");
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new PublishError(
        `Instagram media processing failed (${status}).`,
        "validation"
      );
    }
    // IN_PROGRESS (or unknown) — wait and retry, unless this was the last poll.
    if (i < deps.maxPolls - 1) await deps.sleep(deps.pollDelayMs);
  }
  throw new PublishError(
    "Instagram media not ready yet; will retry.",
    "transient"
  );
}

// Publish to one Instagram account. Returns the published media id.
export async function publishInstagramContainer(
  deps: IgDeps,
  igUserId: string,
  token: string,
  caption: string,
  mediaUrls: string[]
): Promise<string> {
  if (mediaUrls.length === 0) {
    throw new PublishError("No media to publish.", "validation");
  }
  if (mediaUrls.length > IG_MAX_CAROUSEL) {
    throw new PublishError(
      `Instagram supports up to ${IG_MAX_CAROUSEL} items per post.`,
      "validation"
    );
  }

  let creationId: string;
  if (mediaUrls.length === 1) {
    const created = await igPost(deps, `/${igUserId}/media`, {
      image_url: mediaUrls[0],
      caption,
      access_token: token,
    });
    creationId = String(created.id);
  } else {
    // Carousel: every child container first (in order), then the parent.
    const childIds: string[] = [];
    for (const url of mediaUrls) {
      const child = await igPost(deps, `/${igUserId}/media`, {
        image_url: url,
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
    creationId = String(parent.id);
  }

  await waitForContainer(deps, token, creationId);

  const published = await igPost(deps, `/${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: token,
  });
  return String(published.id);
}
