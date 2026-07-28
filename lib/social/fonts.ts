// The faces a template can use, and the one fact about each that the layout
// cannot work without.
//
// ONE REGISTRY, TWO CONSUMERS. The renderer loads these files as ArrayBuffers
// for Satori; the editor's preview loads the same files through
// next/font/local. Both read this list, so a face cannot exist in one and not
// the other, and neither can disagree about which file a name means. That is the
// only thing keeping preview and output in step now that there is more than one
// font.
//
// capOverEm IS PER FACE AND IS NOT OPTIONAL. The design is expressed in cap
// height (see render-template-style.ts); converting that to a font size needs
// sCapHeight/unitsPerEm, which is a property of the face, not a constant. Read
// from each font's own OS/2 table:
//
//   Anton           1760 / 2048 = 0.85938
//   Oswald           810 / 1000 = 0.81000
//   Bebas Neue       700 / 1000 = 0.70000
//   Archivo Narrow   686 / 1000 = 0.68600
//
// They are not close. Reusing Anton's number for Archivo Narrow would render it
// 25% too small, which is the same class of mistake that made the first render
// 43% too small and took a measurement rather than an eye to find.
//
// STATIC INSTANCES, NOT VARIABLE FONTS. Google ships Oswald and Archivo Narrow
// only as variable files, and Satori renders a variable font's default instance
// and ignores the weight axis while a browser honours it. That is preview and
// output disagreeing by construction, so the static instances are fetched from
// the Google Fonts API instead and each weight is its own file.
//
// ALL FOUR ARE OFL. That is a hard constraint, not a preference: these files are
// embedded in a server renderer and shipped in a client bundle, which is
// redistribution. The OFL permits it; most commercial and Canva-bundled licences
// do not. Each licence is vendored beside its font.

export type FontId = "anton" | "oswald" | "bebas-neue" | "archivo-narrow";

export type FontFace = {
  id: FontId;
  // The family name given to Satori and used in fontFamily. Must match what is
  // registered at render time.
  family: string;
  // sCapHeight / unitsPerEm, from the font's own OS/2 table.
  capOverEm: number;
  // Weight -> file, relative to the project root. A weight with no file is a
  // weight this face does not have.
  files: Record<number, string>;
  note: string;
};

export const FONTS: Record<FontId, FontFace> = {
  anton: {
    id: "anton",
    family: "Anton",
    capOverEm: 1760 / 2048,
    files: { 400: "assets/fonts/Anton-Regular.ttf" },
    note: "Heaviest and most compressed. One weight only.",
  },
  oswald: {
    id: "oswald",
    family: "Oswald",
    capOverEm: 810 / 1000,
    files: {
      400: "assets/fonts/Oswald-Regular.ttf",
      700: "assets/fonts/Oswald-Bold.ttf",
    },
    note: "The only face here with a real weight choice.",
  },
  "bebas-neue": {
    id: "bebas-neue",
    family: "Bebas Neue",
    capOverEm: 700 / 1000,
    files: { 400: "assets/fonts/BebasNeue-Regular.ttf" },
    note: "Taller and lighter than Anton. Capitals only by design.",
  },
  "archivo-narrow": {
    id: "archivo-narrow",
    family: "Archivo Narrow",
    capOverEm: 686 / 1000,
    files: {
      400: "assets/fonts/ArchivoNarrow-Regular.ttf",
      700: "assets/fonts/ArchivoNarrow-Bold.ttf",
    },
    note: "Squarer and less shouty. Good when the photo is doing the work.",
  },
};

export const FONT_IDS = Object.keys(FONTS) as FontId[];
export const DEFAULT_FONT: FontId = "anton";

export function isFontId(value: unknown): value is FontId {
  return typeof value === "string" && value in FONTS;
}

export function fontOrDefault(id: unknown): FontFace {
  return FONTS[isFontId(id) ? id : DEFAULT_FONT];
}

export function weightsOf(face: FontFace): number[] {
  return Object.keys(face.files)
    .map(Number)
    .sort((a, b) => a - b);
}

// A weight this face actually has a file for.
//
// Falling back rather than trusting the stored value matters: asking Satori for
// a weight with no file behind it gets a silent substitution, not an error, so
// the picture would quietly stop matching the preview.
export function weightOrDefault(face: FontFace, weight: unknown): number {
  const available = weightsOf(face);
  return typeof weight === "number" && available.includes(weight)
    ? weight
    : (available[0] ?? 400);
}
