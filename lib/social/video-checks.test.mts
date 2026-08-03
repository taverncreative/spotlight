import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkVideo,
  isVideoType,
  type VideoFacts,
} from "@/lib/social/video-checks";

// A 30-second 1080x1920 mp4 at a sane bitrate: valid for a Reel, nothing to say
// about it.
function facts(overrides: Partial<VideoFacts> = {}): VideoFacts {
  return {
    type: "video/mp4",
    bytes: 20 * 1024 * 1024,
    seconds: 30,
    width: 1080,
    height: 1920,
    ...overrides,
  };
}

test("a good Reel raises nothing at all", () => {
  const result = checkVideo(facts());
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(result.warnings, []);
});

// --- blocking: Meta or the bucket will refuse it --------------------------

test("a format Meta refuses is blocked here rather than three minutes in", () => {
  for (const type of ["video/webm", "video/x-matroska", "image/png"]) {
    const result = checkVideo(facts({ type }));
    assert.equal(result.blocking.length, 1, `${type} should block`);
    assert.match(result.blocking[0], /MP4 or MOV/);
  }
  assert.deepEqual(checkVideo(facts({ type: "video/quicktime" })).blocking, []);
});

test("over the plan cap is blocked, and names whose limit it is", () => {
  // The real 111 MB case. "Too large" invites "says who", and the answer is
  // Supabase's Free Plan, not us -- so the message says so rather than sending
  // someone hunting for a setting to change.
  const result = checkVideo(facts({ bytes: 111 * 1024 * 1024 }));
  assert.match(result.blocking.join(" "), /111 MB/);
  assert.match(result.blocking.join(" "), /50 MB/);
  assert.match(result.blocking.join(" "), /Free Plan/);
});

test("just under and just over the cap fall on opposite sides", () => {
  // 49 MB is accepted by the storage API and 51 MB is a 413, measured against
  // the live endpoint. The check has to agree with that seam exactly.
  assert.deepEqual(checkVideo(facts({ bytes: 49 * 1024 * 1024 })).blocking, []);
  assert.equal(
    checkVideo(facts({ bytes: 51 * 1024 * 1024 })).blocking.length,
    1
  );
});

test("under three seconds is blocked: Meta refuses it", () => {
  assert.match(
    checkVideo(facts({ seconds: 2 })).blocking.join(" "),
    /too short/
  );
  assert.deepEqual(checkVideo(facts({ seconds: 3 })).blocking, []);
});

test("beyond fifteen minutes is blocked", () => {
  assert.match(
    checkVideo(facts({ seconds: 16 * 60 })).blocking.join(" "),
    /too long/
  );
});

test("an unreadable duration is blocked rather than assumed fine", () => {
  // The browser failing to decode it is a decent proxy for Meta failing too.
  for (const seconds of [0, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const result = checkVideo(facts({ seconds }));
    assert.match(result.blocking.join(" "), /Could not read this video/);
  }
});

// --- warnings: wrong for a Reel, fine for feed ----------------------------

test("over 90 seconds WARNS rather than blocks, because feed video allows it", () => {
  const result = checkVideo(facts({ seconds: 120 }));
  assert.deepEqual(result.blocking, [], "must not block valid feed video");
  assert.match(result.warnings.join(" "), /too long for a Reel/);
});

test("a landscape video warns about cropping but is not refused", () => {
  const result = checkVideo(facts({ width: 1920, height: 1080 }));
  assert.deepEqual(result.blocking, []);
  assert.match(result.warnings.join(" "), /not 9:16/);
});

test("near-enough 9:16 is not nagged about", () => {
  // 1079x1920 is 0.5620 against 0.5625: a real file, not a mistake.
  assert.deepEqual(
    checkVideo(facts({ width: 1079, height: 1920 })).warnings,
    []
  );
  assert.deepEqual(
    checkVideo(facts({ width: 720, height: 1280 })).warnings,
    []
  );
});

test("below the Reels minimum resolution warns about softness", () => {
  const result = checkVideo(facts({ width: 360, height: 640 }));
  assert.deepEqual(result.blocking, []);
  assert.match(result.warnings.join(" "), /540x960/);
});

test("no size WARNING survives: a file is either fine or refused", () => {
  // The old warning covered a 50-200 MB band that no longer exists. Anything
  // over 50 MB is refused outright; everything under it uploads in chunks with
  // a progress bar. A warning about an empty band is noise.
  for (const mb of [1, 20, 40, 49]) {
    const result = checkVideo(facts({ bytes: mb * 1024 * 1024 }));
    assert.deepEqual(result.warnings, [], `${mb} MB should say nothing`);
    assert.deepEqual(result.blocking, []);
  }
});

test("nothing anywhere still claims an upload cannot resume", () => {
  // It stopped being true when resumable landed, and while it lingered it read
  // as evidence about which code path had run.
  for (const mb of [1, 40, 49, 51, 111]) {
    const result = checkVideo(facts({ bytes: mb * 1024 * 1024 }));
    assert.doesNotMatch(
      [...result.blocking, ...result.warnings].join(" "),
      /cannot resume/
    );
  }
});

// --- the two severities stay separate -------------------------------------

test("a file can be blocked and warned about at once", () => {
  const result = checkVideo(
    facts({ type: "video/webm", seconds: 200, width: 1920, height: 1080 })
  );
  assert.ok(result.blocking.length >= 1);
  assert.ok(result.warnings.length >= 1);
});

test("nothing that only warns ever ends up blocking", () => {
  // The property that matters: a Reels-shaped complaint must never stop an
  // upload, because the same file may be destined for the feed.
  for (const f of [
    facts({ seconds: 120 }),
    facts({ width: 1920, height: 1080 }),
    facts({ width: 360, height: 640 }),
  ]) {
    assert.deepEqual(checkVideo(f).blocking, []);
  }
});

test("isVideoType recognises exactly what the bucket accepts", () => {
  assert.equal(isVideoType("video/mp4"), true);
  assert.equal(isVideoType("video/quicktime"), true);
  assert.equal(isVideoType("video/webm"), false);
  assert.equal(isVideoType("image/png"), false);
});

// --- stories: the same facts, a different severity -------------------------

test("a story blocks on 9:16 where a feed post only warns", () => {
  const square = facts({ width: 1080, height: 1080 });
  const feed = checkVideo(square, "feed");
  assert.deepEqual(feed.blocking, []);
  assert.equal(feed.warnings.length, 1);

  const story = checkVideo(square, "story");
  assert.equal(story.blocking.length, 1);
  assert.match(story.blocking[0], /has to be 9:16/);
});

test("a story caps at 60 seconds, where a feed post allows 90 as a Reel", () => {
  const long = facts({ seconds: 75 });
  assert.deepEqual(checkVideo(long, "feed").blocking, []);
  const story = checkVideo(long, "story");
  assert.equal(story.blocking.length, 1);
  assert.match(story.blocking[0], /too long for a story/);
});

test("exactly 60 seconds is fine for a story", () => {
  assert.deepEqual(checkVideo(facts({ seconds: 60 }), "story").blocking, []);
});

test("a good 9:16 clip raises nothing as a story either", () => {
  const result = checkVideo(facts(), "story");
  assert.deepEqual(result.blocking, []);
  assert.deepEqual(result.warnings, []);
});

test("the format defaults to feed, so existing callers are unchanged", () => {
  const square = facts({ width: 1080, height: 1080 });
  assert.deepEqual(checkVideo(square), checkVideo(square, "feed"));
});

test("a soft story is a warning, not a block: Meta accepts it", () => {
  const soft = facts({ width: 360, height: 640 });
  const story = checkVideo(soft, "story");
  assert.deepEqual(story.blocking, []);
  assert.equal(story.warnings.length, 1);
  assert.match(story.warnings[0], /look soft/);
});
