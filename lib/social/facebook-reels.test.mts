import { test } from "node:test";
import assert from "node:assert/strict";
import {
  publishFacebookReel,
  readReelStatus,
  startReelUpload,
  transferReel,
  type FbDeps,
} from "@/lib/social/facebook-reels";
import { PublishError } from "@/lib/social/publish-errors";

type Call = {
  url: string;
  params: Record<string, string>;
  headers: Record<string, string>;
};

function deps(
  responder: (call: Call, index: number) => unknown
): FbDeps & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    graphUrl: (path: string) => `https://graph.facebook.com/v25.0${path}`,
    ruploadUrl: (videoId: string) =>
      `https://rupload.facebook.com/video-upload/v25.0/${videoId}`,
    sleep: async () => {},
    maxPolls: 3,
    pollDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      const params: Record<string, string> = {};
      if (init?.body instanceof URLSearchParams) {
        for (const [k, v] of init.body) params[k] = v;
      }
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const call = { url: String(url), params, headers };
      calls.push(call);
      return {
        ok: true,
        status: 200,
        json: async () => responder(call, calls.length - 1),
      } as unknown as Response;
    }) as unknown as typeof fetch,
  } as FbDeps & { calls: Call[] };
}

const status = (
  uploading: string,
  processing = "not_started",
  publishing = "not_started"
) => ({
  status: {
    uploading_phase: { status: uploading },
    processing_phase: { status: processing },
    publishing_phase: { status: publishing },
  },
});

// --- the three phases -----------------------------------------------------

test("start asks the PAGE for a video id", async () => {
  const d = deps(() => ({ video_id: "v123" }));
  assert.equal(await startReelUpload(d, "page1", "tok"), "v123");
  assert.match(d.calls[0].url, /graph\.facebook\.com/);
  assert.match(d.calls[0].url, /\/page1\/video_reels$/);
  assert.equal(d.calls[0].params.upload_phase, "start");
});

test("start without a video id is transient, not a silent success", async () => {
  const d = deps(() => ({}));
  await assert.rejects(
    () => startReelUpload(d, "page1", "tok"),
    (e: PublishError) => {
      assert.equal(e.classification, "transient");
      return true;
    }
  );
});

test("the transfer goes to RUPLOAD, with an OAuth header and file_url", async () => {
  // Three things that are all easy to get wrong by analogy with every other
  // call in this codebase: a different host, an OAuth header rather than an
  // access_token param, and no body at all.
  const d = deps(() => ({ success: true }));
  await transferReel(d, "v123", "tok", "https://cdn.test/v.mp4");
  const call = d.calls[0];
  assert.match(call.url, /^https:\/\/rupload\.facebook\.com\//);
  assert.match(call.url, /\/v123$/);
  assert.equal(call.headers.Authorization, "OAuth tok");
  assert.equal(call.headers.file_url, "https://cdn.test/v.mp4");
  assert.equal(call.params.access_token, undefined);
});

test("no video bytes ever pass through this process", async () => {
  // The whole reason file_url is used: streaming a 200MB Reel through a lambda
  // would run into its memory and duration limits.
  const d = deps(() => ({ success: true }));
  await transferReel(d, "v1", "tok", "https://cdn.test/v.mp4");
  assert.deepEqual(d.calls[0].params, {}, "a body would mean we are the pipe");
});

test("a full run does start, transfer, finish, then confirms", async () => {
  const seen: string[] = [];
  const d = deps((call) => {
    if (call.url.includes("rupload")) {
      seen.push("transfer");
      return { success: true };
    }
    if (call.params.upload_phase === "start") {
      seen.push("start");
      return { video_id: "v9" };
    }
    if (call.params.upload_phase === "finish") {
      seen.push("finish");
      return { success: true };
    }
    seen.push("status");
    return status("complete", "complete", "complete");
  });

  const stored: string[] = [];
  const result = await publishFacebookReel(
    d, "page1", "tok", "a caption", "https://cdn.test/v.mp4", null,
    async (id) => { stored.push(id); }
  );

  assert.deepEqual(result, { done: true, videoId: "v9" });
  assert.deepEqual(seen, ["start", "transfer", "finish", "status"]);
  assert.deepEqual(stored, ["v9"], "the id is stored, and stored once");
  const finish = d.calls.find((c) => c.params.upload_phase === "finish")!;
  assert.equal(finish.params.video_state, "PUBLISHED");
  assert.equal(finish.params.description, "a caption");
  assert.equal(finish.params.video_id, "v9");
});

test("the id is stored BEFORE the transfer, so a crash leaves something to resume", async () => {
  const order: string[] = [];
  const d = deps((call) => {
    if (call.url.includes("rupload")) {
      order.push("transfer");
      return { success: true };
    }
    if (call.params.upload_phase === "start") return { video_id: "v1" };
    if (call.params.upload_phase === "finish") return { success: true };
    return status("complete", "complete", "complete");
  });
  await publishFacebookReel(d, "p", "tok", "", "https://cdn.test/v.mp4", null,
    async () => { order.push("stored"); });
  assert.deepEqual(order.slice(0, 2), ["stored", "transfer"]);
});

// --- resuming -------------------------------------------------------------

test("resuming an already-published Reel starts nothing", async () => {
  const d = deps(() => status("complete", "complete", "complete"));
  const result = await publishFacebookReel(
    d, "p", "tok", "", "https://cdn.test/v.mp4", "v-existing",
    async () => assert.fail("must not store a new id when resuming")
  );
  assert.deepEqual(result, { done: true, videoId: "v-existing" });
  assert.equal(d.calls.length, 1, "one status read and nothing else");
  assert.equal(
    d.calls.some((c) => c.params.upload_phase === "start"),
    false,
    "starting again would abandon the session we already have"
  );
});

test("resuming mid-processing waits rather than re-uploading", async () => {
  const d = deps(() => status("complete", "in_progress"));
  await assert.rejects(
    () => publishFacebookReel(d, "p", "tok", "", "u", "v1", async () => {}),
    (e: PublishError) => {
      assert.equal(e.classification, "pending");
      return true;
    }
  );
  assert.equal(
    d.calls.some((c) => c.url.includes("rupload")),
    false,
    "the file is already there; sending it again would be waste"
  );
});

test("resuming an incomplete upload re-issues the transfer and finishes", async () => {
  let asked = 0;
  const d = deps((call) => {
    if (call.url.includes("rupload")) return { success: true };
    if (call.params.upload_phase === "finish") return { success: true };
    asked += 1;
    // First read: the transfer never landed. After re-transfer: done.
    return asked === 1
      ? status("not_started")
      : status("complete", "complete", "complete");
  });
  const result = await publishFacebookReel(
    d, "p", "tok", "", "https://cdn.test/v.mp4", "v1", async () => {}
  );
  assert.deepEqual(result, { done: true, videoId: "v1" });
  assert.equal(d.calls.filter((c) => c.url.includes("rupload")).length, 1);
});

// --- status and failure ---------------------------------------------------

test("an error in ANY phase is terminal, so the session is not polled forever", async () => {
  for (const phase of [
    status("error"),
    status("complete", "error"),
    status("complete", "complete", "error"),
  ]) {
    const d = deps(() => phase);
    await assert.rejects(
      () => readReelStatus(d, "v1", "tok"),
      (e: PublishError) => {
        // validation is what makes the publisher clear container_id.
        assert.equal(e.classification, "validation");
        return true;
      }
    );
  }
});

test("still processing after the budget is PENDING, not transient", async () => {
  // Waiting on Meta's encoder must not spend one of three retries, or a slow
  // Reel gets marked failed for being a video.
  const d = deps((call) => {
    if (call.url.includes("rupload")) return { success: true };
    if (call.params.upload_phase === "start") return { video_id: "v1" };
    if (call.params.upload_phase === "finish") return { success: true };
    return status("complete", "in_progress");
  });
  await assert.rejects(
    () => publishFacebookReel(d, "p", "tok", "", "u", null, async () => {}),
    (e: PublishError) => {
      assert.equal(e.classification, "pending");
      assert.match(e.message, /still processing/i);
      return true;
    }
  );
});

test("a Reel that finishes on a later poll still completes in the same call", async () => {
  let polls = 0;
  const d = deps((call) => {
    if (call.url.includes("rupload")) return { success: true };
    if (call.params.upload_phase === "start") return { video_id: "v1" };
    if (call.params.upload_phase === "finish") return { success: true };
    polls += 1;
    return polls < 3
      ? status("complete", "in_progress")
      : status("complete", "complete", "complete");
  });
  const result = await publishFacebookReel(
    d, "p", "tok", "", "u", null, async () => {}
  );
  assert.equal(result.done, true);
});
