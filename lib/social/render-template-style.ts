// The template style: what a template decides about how a photo and some words
// sit together. Content -- the photo, the words -- is separate on purpose: one
// template dresses many posts.
//
// Its own module, with no server-only import, so both the renderer (server) and
// the merge rules (testable, and later the browser preview) can share one
// definition rather than keeping two in step.

// 4:5, the ratio BSK uses most, and Instagram's tallest feed size.
export const CANVAS = { width: 1122, height: 1402 };

// Anton's cap height as a fraction of its em, read from the font's own OS/2
// table: sCapHeight 1760 over unitsPerEm 2048.
//
// This is what converts a measured design into a font size. A font size is the
// em, and the em is invisible; what the eye reads, and what can be measured off
// a finished image, is the CAP HEIGHT. Sizing by em is how the first attempt
// came out 43% too small.
export const CAP_OVER_EM = 1760 / 2048;

export type ScrimColour = "none" | "black" | "white";

// Everything a template decides. Content (the photo, the words) is separate on
// purpose: one template dresses many posts.
export type TemplateStyle = {
  // --- the photo ---
  // A wash over the WHOLE photo, to calm a busy one. Off by default: the
  // originals do not use it, and reaching for it first flattens a good photo.
  scrim: ScrimColour;
  scrimOpacity: number;

  // --- the type ---
  colour: string;
  weight: number;
  // Text box as fractions of the canvas, so the numbers survive a change of
  // output size.
  x: number;
  y: number;
  width: number;
  // CAP HEIGHT as a fraction of canvas WIDTH. Width, not height, because the
  // originals are not all one ratio, and type proportional to the measure looks
  // consistent across them where type pegged to height does not.
  capHeight: number;
  // Line pitch (baseline to baseline) as a multiple of CAP HEIGHT. Same
  // reasoning: it is the quantity you can measure off a finished image.
  leading: number;

  // --- the highlight ---
  // A solid block behind the words only. PER LINE, not one rectangle, so
  // ragged-right text gets a ragged edge, which is the whole character of the
  // look. A single rectangle around the block is a different, blockier thing.
  highlight: boolean;
  highlightColour: string;
  highlightOpacity: number;
  // Horizontal breathing room, as a multiple of cap height. HORIZONTAL ONLY:
  // vertical padding would grow each line box and push the lines apart, quietly
  // breaking the measured leading. The vertical breathing room comes free,
  // because the line box is already `leading` taller than the caps.
  highlightPadX: number;
};

export type RenderInput = TemplateStyle & {
  photoUrl: string;
  // Newlines are respected exactly. Auto-wrapping alone would destroy the
  // editorial line breaks the look depends on.
  text: string;
};

// EVERY TYPE NUMBER BELOW WAS MEASURED off the original (the yellow wall image,
// 1086x1448, chosen because a plain ground means nothing interferes):
//   cap height   147.2px / 1086 wide  = 0.1355
//   line pitch   162.5px / 147.2 cap  = 1.104
//   left margin   68px   / 1086 wide  = 0.0626
//   first line   215px   / 1448 tall  = 0.1485
export const DEFAULTS: TemplateStyle = {
  scrim: "none",
  scrimOpacity: 0.35,
  colour: "#111111",
  weight: 400,
  x: 0.0626,
  y: 0.1485,
  width: 0.9,
  capHeight: 0.1355,
  leading: 1.104,
  // ON by default. The originals have no highlight because they were composed
  // onto photos with a quiet area; most photos do not have one, and a white
  // block with black type is the treatment that survives a busy picture. Chosen
  // after comparing it against a black block and against a 45% scrim on the same
  // laptop photo.
  highlight: true,
  highlightColour: "#FFFFFF",
  highlightOpacity: 1,
  highlightPadX: 0.12,
};
