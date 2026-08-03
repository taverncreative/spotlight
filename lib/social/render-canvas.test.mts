import { test } from "node:test";
import assert from "node:assert/strict";
import { CANVASES, canvasFor } from "@/lib/social/render-template-style";

// The bug this file exists to prevent: everything rendered at 4:5, so a story
// was cropped to 9:16 by Instagram and the words went with it.

test("a story renders 9:16, which is what Instagram shows", () => {
  const c = canvasFor("story");
  assert.deepEqual(c, { width: 1080, height: 1920 });
  assert.equal(+(c.width / c.height).toFixed(4), +(9 / 16).toFixed(4));
});

test("a feed post still renders 4:5, unchanged", () => {
  const c = canvasFor("feed");
  assert.deepEqual(c, { width: 1122, height: 1402 });
  assert.equal(+(c.width / c.height).toFixed(3), 0.8);
});

test("an unknown format falls back to feed rather than throwing", () => {
  // Same contract the status and dot maps use: a value added later degrades to
  // the ordinary case instead of breaking the renderer.
  assert.deepEqual(canvasFor("something-new"), CANVASES.feed);
  assert.deepEqual(canvasFor(""), CANVASES.feed);
});
