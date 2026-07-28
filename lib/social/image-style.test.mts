import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanStyle, isStale, resolveStyle } from "@/lib/social/image-style";
import { DEFAULTS } from "@/lib/social/render-template-style";

// --- the three layers -----------------------------------------------------

test("nothing stored anywhere gives the code defaults", () => {
  assert.deepEqual(resolveStyle({}, {}), DEFAULTS);
});

test("the template wins over the defaults", () => {
  const style = resolveStyle({ capHeight: 0.2, colour: "#FF0000" }, {});
  assert.equal(style.capHeight, 0.2);
  assert.equal(style.colour, "#FF0000");
  // Untouched keys still come from the defaults.
  assert.equal(style.leading, DEFAULTS.leading);
});

test("an override wins over the template", () => {
  const style = resolveStyle({ y: 0.1, capHeight: 0.2 }, { y: 0.5 });
  assert.equal(style.y, 0.5, "override wins");
  assert.equal(style.capHeight, 0.2, "and does not disturb the rest");
});

// THE PROPERTY THE WHOLE FEATURE RESTS ON.
test("a template edit reaches a post that did not override that field", () => {
  const overrides = { y: 0.5 };
  const before = resolveStyle({ capHeight: 0.12 }, overrides);
  const after = resolveStyle({ capHeight: 0.2 }, overrides);
  assert.equal(before.capHeight, 0.12);
  assert.equal(after.capHeight, 0.2, "template change must reach the post");
  assert.equal(after.y, 0.5, "and must not clobber what the post chose");
});

test("a post that overrode a field is NOT moved by a template edit", () => {
  const before = resolveStyle({ capHeight: 0.12 }, { capHeight: 0.3 });
  const after = resolveStyle({ capHeight: 0.2 }, { capHeight: 0.3 });
  assert.equal(before.capHeight, 0.3);
  assert.equal(after.capHeight, 0.3);
});

// --- what gets let through ------------------------------------------------

test("unknown keys never reach a render", () => {
  const cleaned = cleanStyle({ capHeight: 0.2, somethingElse: "nope" });
  assert.deepEqual(Object.keys(cleaned), ["capHeight"]);
});

test("a value of the wrong type is dropped, so the layer beneath decides", () => {
  // A hand-edited row or a renamed field: merging this blindly reaches Satori
  // as a broken layout rather than as an error.
  const style = resolveStyle({ capHeight: "big", highlight: "yes" }, {});
  assert.equal(style.capHeight, DEFAULTS.capHeight);
  assert.equal(style.highlight, DEFAULTS.highlight);
});

test("NaN and Infinity are not numbers for this purpose", () => {
  const style = resolveStyle({ leading: Number.NaN, x: Number.POSITIVE_INFINITY }, {});
  assert.equal(style.leading, DEFAULTS.leading);
  assert.equal(style.x, DEFAULTS.x);
});

test("an unknown scrim falls back rather than silently rendering none", () => {
  assert.equal(resolveStyle({ scrim: "chartreuse" }, {}).scrim, DEFAULTS.scrim);
  assert.equal(resolveStyle({ scrim: "black" }, {}).scrim, "black");
  assert.equal(resolveStyle({ scrim: "black" }, { scrim: "none" }).scrim, "none");
});

test("junk in the column is not a crash", () => {
  for (const junk of [null, undefined, 42, "a string", [], [{ capHeight: 1 }]]) {
    assert.deepEqual(cleanStyle(junk), {}, `${JSON.stringify(junk)} should clean to {}`);
  }
  assert.deepEqual(resolveStyle(null, undefined), DEFAULTS);
});

test("false and zero survive, because they are real values", () => {
  // A naive truthiness filter would drop both and turn "highlight off" into
  // "highlight inherited", which is the opposite of what was stored.
  const style = resolveStyle({ highlight: false, scrimOpacity: 0 }, {});
  assert.equal(style.highlight, false);
  assert.equal(style.scrimOpacity, 0);
});

// --- staleness ------------------------------------------------------------

test("never rendered is stale", () => {
  assert.equal(isStale(null, null, "2026-07-28T00:00:00Z"), true);
  assert.equal(isStale("some/path.png", null, "2026-07-28T00:00:00Z"), true);
  assert.equal(isStale(null, "2026-07-28T00:00:00Z", "2026-07-28T00:00:00Z"), true);
});

test("rendered before the template changed is stale", () => {
  assert.equal(
    isStale("p.png", "2026-07-01T00:00:00Z", "2026-07-28T00:00:00Z"),
    true
  );
});

test("rendered after the template changed is fresh", () => {
  assert.equal(
    isStale("p.png", "2026-07-28T12:00:00Z", "2026-07-28T00:00:00Z"),
    false
  );
});

// --- fonts ----------------------------------------------------------------

test("an unknown font falls back rather than reaching the renderer", () => {
  // typeof alone lets any string through, and Satori answers an unknown family
  // with a silent substitution rather than an error -- so the picture would stop
  // matching the preview with nothing to show for it.
  assert.equal(resolveStyle({ font: "comic-sans" }, {}).font, DEFAULTS.font);
  assert.equal(resolveStyle({ font: 42 }, {}).font, DEFAULTS.font);
  assert.equal(resolveStyle({ font: "oswald" }, {}).font, "oswald");
});

test("a post can override the template's font", () => {
  assert.equal(resolveStyle({ font: "anton" }, { font: "bebas-neue" }).font, "bebas-neue");
});
