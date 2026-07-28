import { test } from "node:test";
import assert from "node:assert/strict";
import { checkVideo, isVideoType, type VideoFacts } from "@/lib/social/video-checks";

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

test("over the bucket ceiling is blocked, and says the ceiling", () => {
  const result = checkVideo(facts({ bytes: 250 * 1024 * 1024 }));
  assert.match(result.blocking.join(" "), /250 MB is too large/);
  assert.match(result.blocking.join(" "), /200 MB/);
});

test("under three seconds is blocked: Meta refuses it", () => {
  assert.match(checkVideo(facts({ seconds: 2 })).blocking.join(" "), /too short/);
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
  assert.deepEqual(checkVideo(facts({ width: 1079, height: 1920 })).warnings, []);
  assert.deepEqual(checkVideo(facts({ width: 720, height: 1280 })).warnings, []);
});

test("below the Reels minimum resolution warns about softness", () => {
  const result = checkVideo(facts({ width: 360, height: 640 }));
  assert.deepEqual(result.blocking, []);
  assert.match(result.warnings.join(" "), /540x960/);
});

test("a large but legal file warns about the upload, not the video", () => {
  const result = checkVideo(facts({ bytes: 120 * 1024 * 1024 }));
  assert.deepEqual(result.blocking, []);
  assert.match(result.warnings.join(" "), /take a few minutes/);
  // And it comes last, because it is a caveat rather than the headline.
  assert.match(result.warnings.at(-1)!, /take a few minutes/);
  // It must NOT claim the upload cannot resume: above 6 MB it now can, and a
  // stale warning reads as evidence about which code path ran.
  assert.doesNotMatch(result.warnings.join(" "), /cannot resume/);
});

test("a file under the warning threshold says nothing about size", () => {
  assert.deepEqual(checkVideo(facts({ bytes: 40 * 1024 * 1024 })).warnings, []);
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
    facts({ bytes: 120 * 1024 * 1024 }),
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
