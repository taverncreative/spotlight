// The brand accent (Design Pass 1). One calm, tasteful default that the whole
// design system reads through the --brand CSS variable (active navigation,
// primary buttons, key highlights, focus rings). A workspace may override it
// with its own brand_color (organisations.brand_color); the app shell sets
// --brand from the resolved value, so a changed colour re-themes everywhere.

// A restrained indigo: premium without being flashy, and it reads well on both
// the dark (default) and light canvases. This is the steer-able default; the
// per-workspace colour picker is a later pass.
export const DEFAULT_BRAND_COLOR = "#5b5bd6";

// brand_color reaches an inline style as a custom-property value, so it must be
// validated, not trusted. Only a plain hex colour (#rgb, #rrggbb or #rrggbbaa)
// is accepted; anything else returns null so the caller falls back to the
// default and a malformed value can never break out of the declaration.
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function sanitiseBrandColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return HEX_COLOR.test(trimmed) ? trimmed : null;
}

// The colour the shell should apply for a workspace: its own if valid, else the
// default. Used to set the --brand custom property on the app frame.
export function resolveBrandColor(value: string | null | undefined): string {
  return sanitiseBrandColor(value) ?? DEFAULT_BRAND_COLOR;
}

// Brand contrast helpers (used by the public quote page). The brand colour is
// chosen by the agency and may be anything, so on a light document we must
// (1) pick a readable text colour to sit on a brand fill, and (2) derive a
// darker shade when the brand is too light to read as coloured text on white.
// All pure, deriving from the resolved hex; an unparseable value falls back to
// sensible inks so the page can never render unreadable.

type Rgb = { r: number; g: number; b: number };

// A near-black ink and white, the two candidates for text on a brand fill and
// the floor for derived brand text.
const INK = "#0b0b0f";
const WHITE = "#ffffff";

function parseHex(value: string): Rgb | null {
  const hex = sanitiseBrandColor(value);
  if (!hex) return null;
  let body = hex.slice(1);
  if (body.length === 3) {
    body = body
      .split("")
      .map((c) => c + c)
      .join("");
  }
  // Drop any alpha; contrast is computed against the opaque colour.
  if (body.length === 8) body = body.slice(0, 6);
  const int = Number.parseInt(body, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function toHex({ r, g, b }: Rgb): string {
  const part = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

// WCAG relative luminance.
function luminance({ r, g, b }: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// WCAG contrast ratio between two luminances.
function contrast(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

// The readable text colour to place on a brand fill (e.g. the Accept button):
// near-black or white, whichever contrasts better with the fill.
export function brandForegroundColor(brand: string): string {
  const rgb = parseHex(brand);
  if (!rgb) return WHITE;
  const fill = luminance(rgb);
  const onWhite = contrast(fill, luminance({ r: 255, g: 255, b: 255 }));
  const onInk = contrast(fill, luminance({ r: 11, g: 11, b: 15 }));
  return onInk >= onWhite ? INK : WHITE;
}

// A brand shade safe for coloured text on a white document: if the raw brand
// already meets WCAG AA (4.5:1) on white it is used unchanged; otherwise it is
// darkened toward black (preserving hue) until it does. The loop is bounded and
// black-on-white is 21:1, so it always converges.
export function brandTextColor(brand: string): string {
  const rgb = parseHex(brand);
  if (!rgb) return INK;
  const white = luminance({ r: 255, g: 255, b: 255 });
  let current = { ...rgb };
  for (let i = 0; i < 24; i++) {
    if (contrast(luminance(current), white) >= 4.5) break;
    current = {
      r: current.r * 0.88,
      g: current.g * 0.88,
      b: current.b * 0.88,
    };
  }
  return toHex(current);
}
