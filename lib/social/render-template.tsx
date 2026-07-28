import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactElement } from "react";

// The social image template: a photo, some words, and everything about how they
// sit together.
//
// Every value in TemplateStyle is DATA, not a constant. Slice 2 stores it,
// slice 3 puts controls on it. Nothing here should need editing to change how an
// image looks.
//
// THE LOOK, measured off BSK's real files rather than described:
//   * portrait, 1122x1402 on 13 of the 17 media rows that record dimensions
//   * full-bleed photo, no frame
//   * heavy condensed uppercase grotesque, near-black
//   * cap height 0.1355 of the canvas width, line pitch 1.104 of the cap
//   * left aligned, ragged right, one uniform size
//   * line breaks are EDITORIAL, not wrapped
//
// The originals use no scrim and no highlight, because they were composed onto
// photos with a quiet area -- a yellow wall, an empty sky. Both exist here for
// the photos that have no such area, which is most of them.

// 4:5, the ratio BSK uses most, and Instagram's tallest feed size.
export const CANVAS = { width: 1122, height: 1402 };

// Anton's cap height as a fraction of its em, read from the font's own OS/2
// table: sCapHeight 1760 over unitsPerEm 2048.
//
// This is what converts a measured design into a font size. A font size is the
// em, and the em is invisible; what the eye reads, and what can be measured off
// a finished image, is the CAP HEIGHT. Sizing by em is how the first attempt
// came out 43% too small.
const CAP_OVER_EM = 1760 / 2048;

// Anton, SIL Open Font License 1.1 (assets/fonts/Anton-OFL.txt). A stand-in for
// whatever BSK's real face is: condensed, heavy, and free to embed in a
// renderer, which a Canva-bundled or commercially licensed face may not be.
//
// SINGLE WEIGHT. Anton ships 400 and nothing else, so `weight` below is part of
// the model and has exactly one valid value today. It is modelled anyway because
// slice 2 stores this shape, and adding a second face later should be data
// rather than a migration of every stored template.
const FONT_FILE = "assets/fonts/Anton-Regular.ttf";
export const FONT_NAME = "Anton";
export const FONT_WEIGHTS = [400] as const;

let cached: Buffer | null = null;
export async function loadFont(): Promise<Buffer> {
  // Read once per lambda. 167KB, which matters against ImageResponse's 500KB
  // budget for everything it carries.
  cached ??= await readFile(join(process.cwd(), FONT_FILE));
  return cached;
}

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

// #RGB or #RRGGBB plus an alpha, as rgba(). Satori takes rgba() strings; keeping
// colour and opacity as two fields is what lets the editor offer two controls
// rather than asking anyone to think in eight-digit hex.
function rgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const value = Number.parseInt(full, 16);
  if (full.length !== 6 || !Number.isFinite(value)) {
    return `rgba(255,255,255,${alpha})`;
  }
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${Math.min(Math.max(alpha, 0), 1)})`;
}

export function templateElement(input: RenderInput): ReactElement {
  // Measured design -> font size. The em is what the renderer wants; the cap
  // height is what the design is expressed in.
  const capPx = input.capHeight * CANVAS.width;
  const fontSize = capPx / CAP_OVER_EM;
  // Satori's line-height is a multiple of the em, so a pitch measured in cap
  // heights converts through the same ratio.
  const lineHeight = (input.leading * capPx) / fontSize;
  const lines = input.text.replace(/\\n/g, "\n").split("\n");

  const padX = input.highlight ? input.highlightPadX * capPx : 0;
  const scrimColour =
    input.scrim === "black"
      ? "#000000"
      : input.scrim === "white"
        ? "#FFFFFF"
        : null;

  return (
    <div
      style={{
        display: "flex",
        width: CANVAS.width,
        height: CANVAS.height,
        position: "relative",
      }}
    >
      {/* Full bleed. object-fit cover so any source ratio fills the canvas
          rather than letterboxing.
          This JSX is never rendered by a browser -- Satori consumes it and
          rasterises to PNG -- so next/image would be meaningless here, and alt
          text has nothing to describe it to. */}
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img
        src={input.photoUrl}
        width={CANVAS.width}
        height={CANVAS.height}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: CANVAS.width,
          height: CANVAS.height,
          objectFit: "cover",
        }}
      />

      {/* Between the photo and the words, so it calms the picture without
          touching the type. */}
      {scrimColour ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: CANVAS.width,
            height: CANVAS.height,
            backgroundColor: rgba(scrimColour, input.scrimOpacity),
          }}
        />
      ) : null}

      <div
        style={{
          position: "absolute",
          // Shifted left by the padding so the TEXT stays put when the highlight
          // is toggled. Without this, turning the highlight on nudges every word
          // to the right, which reads as a bug while you are working.
          left: input.x * CANVAS.width - padX,
          top: input.y * CANVAS.height,
          width: input.width * CANVAS.width + padX * 2,
          display: "flex",
          flexDirection: "column",
          // THE LINE THAT MAKES THE HIGHLIGHT RAGGED. Flex children stretch to
          // the container by default, so every highlight would be the same
          // full-width rectangle and the ragged right edge -- the character of
          // the look -- would be gone.
          alignItems: "flex-start",
        }}
      >
        {/* ONE DIV PER LINE, not one block with newlines. It keeps each
            editorial break intact regardless of how Satori would have wrapped
            the string, makes the leading exact, and is what gives each line its
            own highlight. */}
        {lines.map((line, index) => (
          <div
            key={index}
            style={{
              fontFamily: FONT_NAME,
              fontSize,
              fontWeight: input.weight,
              lineHeight,
              color: input.colour,
              textTransform: "uppercase",
              whiteSpace: "pre",
              paddingLeft: padX,
              paddingRight: padX,
              ...(input.highlight
                ? {
                    backgroundColor: rgba(
                      input.highlightColour,
                      input.highlightOpacity
                    ),
                  }
                : {}),
            }}
          >
            {/* A blank line still needs to occupy its line box, and to carry a
                highlight if one is on. */}
            {line === "" ? " " : line}
          </div>
        ))}
      </div>
    </div>
  );
}
