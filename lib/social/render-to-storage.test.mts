import { test } from "node:test";
import assert from "node:assert/strict";
import { isRenderPath, renderPath } from "@/lib/social/render-to-storage-paths";

// --- where a render lives -------------------------------------------------

test("the first segment is the CLIENT id, which the storage policy requires", () => {
  // 0028 authorises writes with owns_client on foldername[1]. Any other shape
  // is rejected by the database rather than merely untidy.
  const path = renderPath("client-1", "post-9", "recipe-3", 1700000000000);
  assert.equal(path.split("/")[0], "client-1");
  assert.equal(path.split("/")[1], "post-9");
});

test("renders sit under their own segment, so they are distinguishable", () => {
  const path = renderPath("c", "p", "r", 1);
  assert.ok(path.includes("/renders/"));
  assert.equal(isRenderPath(path), true);
});

test("a source photo is not mistaken for a render", () => {
  // This is what stops the editor offering a composed image back as the source
  // for the next render -- words composited onto words.
  assert.equal(isRenderPath("client/post/f511af7d-635b.jpg"), false);
  assert.equal(isRenderPath("client/post/photo-renders.jpg"), false);
});

test("two renders of the same recipe never share a path", () => {
  // A stable path plus overwrite would be tidier and wrong: the bucket is
  // public and CDN-backed, so the old bytes keep being served.
  const a = renderPath("c", "p", "r", 1700000000000);
  const b = renderPath("c", "p", "r", 1700000000001);
  assert.notEqual(a, b);
});

test("the path ends in .png, because that is what is uploaded", () => {
  assert.ok(renderPath("c", "p", "r", 1).endsWith(".png"));
});
