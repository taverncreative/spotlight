import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createInstagramContainer,
  finishInstagramContainer,
  readContainerStatus,
  type IgDeps,
  type IgItem,
} from "@/lib/social/instagram-publish";
import { PublishError } from "@/lib/social/publish-errors";

// The module is transport-injected precisely so the Graph layer can be faked.
// Every call is recorded so the tests can assert the SHAPE of what Instagram was
// asked for, which is the part that silently goes wrong.

type Call = { url: string; params: Record<string, string> };

function deps(
  responder: (call: Call, index: number) => unknown
): IgDeps & { calls: Call[] } {
  const calls: Call[] = [];
  const d = {
    calls,
    graphUrl: (path: string) => `https://graph.test${path}`,
    sleep: async () => {},
    maxPolls: 3,
    pollDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      const params: Record<string, string> = {};
      if (init?.body instanceof URLSearchParams) {
        for (const [k, v] of init.body) params[k] = v;
      }
      const call = { url: String(url), params };
      calls.push(call);
      const body = responder(call, calls.length - 1);
      return {
        ok: true,
        status: 200,
        json: async () => body,
      } as unknown as Response;
    }) as unknown as typeof fetch,
  };
  return d as IgDeps & { calls: Call[] };
}

const photo = (n = 1): IgItem[] =>
  Array.from({ length: n }, (_, i) => ({
    url: `https://cdn.test/p${i}.jpg`,
    isVideo: false,
  }));
const video: IgItem[] = [{ url: "https://cdn.test/v.mp4", isVideo: true }];

// --- what gets asked for ---------------------------------------------------

test("a single video is created as a REEL, with video_url", async () => {
  const d = deps(() => ({ id: "c1" }));
  const id = await createInstagramContainer(d, "ig1", "tok", "hello", video);
  assert.equal(id, "c1");
  assert.equal(d.calls.length, 1, "one call: no child containers for one item");
  assert.equal(d.calls[0].params.media_type, "REELS");
  assert.equal(d.calls[0].params.video_url, "https://cdn.test/v.mp4");
  assert.equal(d.calls[0].params.caption, "hello");
  assert.equal(d.calls[0].params.image_url, undefined, "a video is not an image");
});

test("a single photo is unchanged: image_url, no media_type", async () => {
  const d = deps(() => ({ id: "c1" }));
  await createInstagramContainer(d, "ig1", "tok", "hi", photo(1));
  assert.equal(d.calls[0].params.image_url, "https://cdn.test/p0.jpg");
  assert.equal(d.calls[0].params.media_type, undefined);
});

test("a photo carousel is unchanged: children first, then the parent", async () => {
  const d = deps((_, i) => ({ id: `child${i}` }));
  await createInstagramContainer(d, "ig1", "tok", "hi", photo(3));
  assert.equal(d.calls.length, 4, "three children plus one parent");
  for (let i = 0; i < 3; i++) {
    assert.equal(d.calls[i].params.is_carousel_item, "true");
  }
  const parent = d.calls[3].params;
  assert.equal(parent.media_type, "CAROUSEL");
  assert.equal(parent.children, "child0,child1,child2");
  assert.equal(parent.caption, "hi", "the caption belongs to the parent only");
});

// --- what is refused, and how clearly --------------------------------------

test("a mixed carousel is refused by name rather than half-attempted", async () => {
  const d = deps(() => ({ id: "c" }));
  await assert.rejects(
    () => createInstagramContainer(d, "ig1", "tok", "", [...photo(2), ...video]),
    (error: PublishError) => {
      assert.equal(error.classification, "validation");
      assert.match(error.message, /one video, or up to 10 photos/);
      return true;
    }
  );
  assert.equal(d.calls.length, 0, "nothing should be created for a refused shape");
});

test("more than ten items is refused before any container is made", async () => {
  const d = deps(() => ({ id: "c" }));
  await assert.rejects(
    () => createInstagramContainer(d, "ig1", "tok", "", photo(11)),
    /up to 10 items/
  );
  assert.equal(d.calls.length, 0);
});

test("nothing to publish is a validation error, not a crash", async () => {
  const d = deps(() => ({ id: "c" }));
  await assert.rejects(
    () => createInstagramContainer(d, "ig1", "tok", "", []),
    /No media/
  );
});

// --- the status read -------------------------------------------------------

test("FINISHED and PUBLISHED both count as ready", async () => {
  for (const status_code of ["FINISHED", "PUBLISHED"]) {
    const d = deps(() => ({ status_code }));
    assert.equal(await readContainerStatus(d, "tok", "c1"), "ready");
  }
});

test("IN_PROGRESS is processing, not an error", async () => {
  const d = deps(() => ({ status_code: "IN_PROGRESS" }));
  assert.equal(await readContainerStatus(d, "tok", "c1"), "processing");
});

test("ERROR and EXPIRED are terminal, so the caller forgets the container", async () => {
  for (const status_code of ["ERROR", "EXPIRED"]) {
    const d = deps(() => ({ status_code }));
    await assert.rejects(
      () => readContainerStatus(d, "tok", "c1"),
      (error: PublishError) => {
        // validation is what makes the publisher clear container_id, which is
        // what stops the next tick polling a dead container forever.
        assert.equal(error.classification, "validation");
        assert.match(error.message, new RegExp(status_code));
        return true;
      }
    );
  }
});

// --- finishing, and the pending contract -----------------------------------

test("a container that is ready publishes and returns the media id", async () => {
  const d = deps((call) =>
    call.url.includes("media_publish") ? { id: "media99" } : { status_code: "FINISHED" }
  );
  const id = await finishInstagramContainer(d, "ig1", "tok", "c1");
  assert.equal(id, "media99");
  assert.equal(d.calls.at(-1)!.params.creation_id, "c1");
});

test("still processing after the budget raises PENDING, not transient", async () => {
  // This is the whole point of the slice: pending means "look again next tick"
  // and must not spend one of three retries, or a slow Reel gets marked failed
  // for taking a few minutes to encode.
  const d = deps(() => ({ status_code: "IN_PROGRESS" }));
  await assert.rejects(
    () => finishInstagramContainer(d, "ig1", "tok", "c1"),
    (error: PublishError) => {
      assert.equal(error.classification, "pending");
      assert.match(error.message, /still processing/i);
      return true;
    }
  );
  assert.equal(d.calls.length, 3, "polls up to maxPolls, then gives up");
});

test("it never publishes a container that is not ready", async () => {
  const d = deps(() => ({ status_code: "IN_PROGRESS" }));
  await assert.rejects(() => finishInstagramContainer(d, "ig1", "tok", "c1"));
  assert.equal(
    d.calls.some((c) => c.url.includes("media_publish")),
    false,
    "publishing an unfinished container is how you get a broken post"
  );
});

test("a container ready on a later poll still publishes in the same call", async () => {
  // The fast path: an image is usually FINISHED within a couple of seconds, and
  // making that wait a whole cron tick would make a working feature slower.
  let polls = 0;
  const d = deps((call) => {
    if (call.url.includes("media_publish")) return { id: "media7" };
    polls += 1;
    return { status_code: polls < 3 ? "IN_PROGRESS" : "FINISHED" };
  });
  assert.equal(await finishInstagramContainer(d, "ig1", "tok", "c1"), "media7");
});

// --- creation and finishing are genuinely separable ------------------------

test("finishing needs no creation, which is what resuming depends on", async () => {
  // Next tick holds only a stored id. If finishing required the creation call,
  // every tick would build a new container and spend Instagram's daily limit.
  const d = deps((call) =>
    call.url.includes("media_publish") ? { id: "m" } : { status_code: "FINISHED" }
  );
  await finishInstagramContainer(d, "ig1", "tok", "stored-container-id");
  assert.equal(
    d.calls.some((c) => c.params.image_url || c.params.video_url),
    false,
    "no container was created"
  );
});
