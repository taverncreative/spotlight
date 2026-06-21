// Unit test for lib/brand's brandTextColor. Runs with: npm run test:brand
//
// brandTextColor returns a brand shade safe for coloured text on a white
// document: a too-light input is darkened (hue preserved) until it meets WCAG AA
// (4.5:1) on white; an already-dark input that already passes is returned
// unchanged. This proves both directions with an independent contrast
// computation, so the helper and the assertion can never agree by sharing code.

import { brandTextColor, DEFAULT_BRAND_COLOR } from "../lib/brand.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${detail})`}`);
  if (!ok) failures += 1;
}

// Independent WCAG relative-luminance and contrast, not imported from lib/brand.
function luminance(hex: string): number {
  const body = hex.slice(1);
  const r = Number.parseInt(body.slice(0, 2), 16);
  const g = Number.parseInt(body.slice(2, 4), 16);
  const b = Number.parseInt(body.slice(4, 6), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastOnWhite(hex: string): number {
  const l = luminance(hex);
  const white = luminance("#ffffff");
  return (white + 0.05) / (l + 0.05);
}

const isSixHex = (value: string) => /^#[0-9a-f]{6}$/.test(value);

// Too-light inputs: each must be darkened until it reads on white (>= 4.5:1).
const lightInputs = ["#ffffff", "#ffd400", "#f5f5f5", "#9ad0ff", "#cccccc"];
for (const input of lightInputs) {
  const out = brandTextColor(input);
  const ratio = contrastOnWhite(out);
  check(
    `too-light ${input} -> ${out} meets AA on white`,
    isSixHex(out) && ratio >= 4.5,
    `contrast ${ratio.toFixed(2)}:1`
  );
}

// Already-dark inputs: they already meet AA, so they are returned unchanged
// (the loop breaks on the first iteration) and still read on white.
const darkInputs = [DEFAULT_BRAND_COLOR, "#1a1a1a", "#0b5fff", "#7a1fa2"];
for (const input of darkInputs) {
  const out = brandTextColor(input);
  const ratio = contrastOnWhite(out);
  check(
    `already-dark ${input} -> ${out} meets AA on white`,
    isSixHex(out) && ratio >= 4.5,
    `contrast ${ratio.toFixed(2)}:1`
  );
  check(
    `already-dark ${input} is returned unchanged`,
    out === input.toLowerCase(),
    `got ${out}`
  );
}

// An unparseable input falls back to a dark ink that reads on white.
const fallback = brandTextColor("not-a-colour");
check(
  `unparseable input falls back to a readable ink (${fallback})`,
  isSixHex(fallback) && contrastOnWhite(fallback) >= 4.5,
  `contrast ${contrastOnWhite(fallback).toFixed(2)}:1`
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll brandTextColor assertions passed");
