import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

// Minimal TrueType reader: unitsPerEm from `head`, sCapHeight from `OS/2`.
// Deliberately parsed here rather than imported from the app, so the test checks
// the registry against the FILES rather than against another copy of the same
// numbers.
function readCapMetrics(path: string): { capOverEm: number } {
  const f = readFileSync(path);
  const numTables = f.readUInt16BE(4);
  const tables = new Map<string, number>();
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables.set(f.subarray(o, o + 4).toString("latin1"), f.readUInt32BE(o + 8));
  }
  const head = tables.get("head")!;
  const os2 = tables.get("OS/2")!;
  const unitsPerEm = f.readUInt16BE(head + 18);
  const capHeight = f.readInt16BE(os2 + 88);
  return { capOverEm: capHeight / unitsPerEm };
}
import {
  DEFAULT_FONT,
  FONTS,
  FONT_IDS,
  fontOrDefault,
  isFontId,
  weightOrDefault,
  weightsOf,
} from "@/lib/social/fonts";

test("every registered file exists and is a real TrueType font", () => {
  // Four files fetched during this build were GitHub 404 pages of ~326KB, which
  // passed a size check. Magic bytes are the check that would have caught it.
  for (const id of FONT_IDS) {
    for (const [weight, path] of Object.entries(FONTS[id].files)) {
      assert.ok(
        statSync(path).size > 10_000,
        `${path} is too small to be a font`
      );
      const magic = readFileSync(path).subarray(0, 4).toString("hex");
      assert.ok(
        magic === "00010000" || magic === "74727565",
        `${path} (${id} ${weight}) is not a TrueType font, magic ${magic}`
      );
    }
  }
});

// THE REAL INVARIANT, and it replaced a weaker one. The first version asserted
// every ratio was distinct, on the reasoning that a repeat meant a copy-paste.
// With nine faces that is asserting a coincidence -- Abril Fatface, Bebas Neue
// and Space Grotesk all genuinely sit at exactly 0.700. Reading the number back
// out of each font's own OS/2 table catches a copied ratio properly, and would
// have caught it at four faces too.
test("every registered cap ratio matches the font file it describes", () => {
  for (const id of FONT_IDS) {
    const face = FONTS[id];
    for (const path of Object.values(face.files)) {
      const { capOverEm } = readCapMetrics(path);
      assert.ok(
        Math.abs(capOverEm - face.capOverEm) < 1e-9,
        `${id}: registry says ${face.capOverEm}, ${path} says ${capOverEm}`
      );
    }
  }
});

test("the faces span a real range, so the ratio cannot be a constant", () => {
  const ratios = FONT_IDS.map((id) => FONTS[id].capOverEm);
  // Anton 0.859 down to Archivo Narrow 0.686: one number for all of them
  // renders the narrow faces a quarter too small.
  assert.ok(Math.max(...ratios) - Math.min(...ratios) > 0.15);
});

test("cap ratios are plausible for capital letters", () => {
  for (const id of FONT_IDS) {
    const ratio = FONTS[id].capOverEm;
    assert.ok(ratio > 0.5 && ratio < 1, `${id} ratio ${ratio} is not credible`);
  }
});

test("an unknown font id resolves to the default rather than throwing", () => {
  assert.equal(fontOrDefault("nonsense").id, DEFAULT_FONT);
  assert.equal(fontOrDefault(null).id, DEFAULT_FONT);
  assert.equal(fontOrDefault("oswald").id, "oswald");
  assert.equal(isFontId("oswald"), true);
  assert.equal(isFontId("helvetica"), false);
});

test("a weight the face lacks is clamped to one it has", () => {
  // Satori substitutes silently for a missing weight, so this must never pass
  // through unchecked.
  assert.equal(weightOrDefault(FONTS.anton, 700), 400, "Anton has no bold");
  assert.equal(weightOrDefault(FONTS.oswald, 700), 700, "Oswald does");
  assert.equal(weightOrDefault(FONTS.oswald, 999), 400);
  assert.equal(weightOrDefault(FONTS["bebas-neue"], 700), 400);
});

test("Oswald is the face with a real weight choice", () => {
  assert.deepEqual(weightsOf(FONTS.oswald), [400, 700]);
  assert.deepEqual(weightsOf(FONTS.anton), [400]);
  assert.deepEqual(weightsOf(FONTS["bebas-neue"]), [400]);
});

test("the default face is one that exists", () => {
  assert.ok(FONT_IDS.includes(DEFAULT_FONT));
});
