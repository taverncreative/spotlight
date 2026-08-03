// The template style: what a template decides about how a photo and some words
// sit together. Content -- the photo, the words -- is separate on purpose: one
// template dresses many posts.
//
// Its own module, with no server-only import, so both the renderer (server) and
// the merge rules (testable, and later the browser preview) can share one
// definition rather than keeping two in step.

import type { FontId } from "@/lib/social/fonts";

export type Canvas = { width: number; height: number };

// THE CANVAS IS A PROPERTY OF THE FORMAT, not a constant, and that was a real
// bug rather than a tidiness point.
//
// Everything rendered at 1122x1402 (4:5). That is right for a feed post and
// wrong for a story: Instagram shows a story at 9:16 and crops a 4:5 image to
// fit, so words placed near the top or bottom in the editor were cut off in the
// app. The preview was honest about the picture it was describing; the picture
// was the wrong shape.
//
// Rendering a story at 9:16 means Instagram crops nothing, which is what makes
// the preview true again.
//
// Style values are all FRACTIONS of the canvas -- x and width of the width, y of
// the height, cap height of the width -- so one template lays out proportionally
// on either canvas rather than needing a story-specific copy.
export const CANVASES = {
  // 4:5, the ratio BSK uses most, and Instagram's tallest feed size.
  feed: { width: 1122, height: 1402 },
  // 9:16. Meta's recommended story size on both platforms.
  story: { width: 1080, height: 1920 },
} as const satisfies Record<string, Canvas>;

export function canvasFor(format: string): Canvas {
  return format === "story" ? CANVASES.story : CANVASES.feed;
}

// The feed canvas, kept under its old name for the callers that are genuinely
// about a feed post: the template rows stamp the canvas they were designed
// against, and that is 4:5 for every template that exists.
export const CANVAS = CANVASES.feed;

// The per-face cap-height ratio now lives in lib/social/fonts.ts, because it is
// a property of the font rather than of this template. It was a single constant
// while Anton was the only face, and leaving it that way would have rendered
// Archivo Narrow 25% too small.

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
  // Which face. The cap-height ratio that converts the design into a font size
  // is a property of the FACE, not a constant, so this decides the arithmetic as
  // well as the letterforms -- see lib/social/fonts.ts.
  font: FontId;
  colour: string;
  // Only meaningful where the face has more than one file. Anton and Bebas Neue
  // ship a single weight; asking for another gets a silent substitution rather
  // than an error, so it is clamped to what the face actually has.
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
  // Breathing room around the words, as multiples of cap height.
  //
  // BOTH AXES, but they work differently. Horizontal padding simply widens the
  // block. Vertical padding is paired with an equal NEGATIVE margin, so the
  // block grows upward and downward while contributing nothing to layout: the
  // text does not move and the line pitch stays exactly as measured. Plain
  // vertical padding would push the lines apart and quietly break the leading,
  // which is why there was none until now.
  highlightPadX: number;
  highlightPadY: number;
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
  font: "anton",
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
  // Enough that the caps are not touching the edge. Smaller than the horizontal
  // padding on purpose: the line box already carries some room above and below
  // the caps, so equal numbers read as too much.
  highlightPadY: 0.06,
};
