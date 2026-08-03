import {
  DEFAULTS,
  type TemplateStyle,
} from "@/lib/social/render-template-style";
import { isFontId } from "@/lib/social/fonts";

// Merging a stored template and a post's overrides into one style.
//
// THREE LAYERS, resolved in order: code defaults, then the template's style,
// then the post's overrides. Each is a partial of the one before.
//
// That layering is the whole reason a template change reaches existing posts. A
// post stores only what it deliberately changed, so everything it did not
// override still comes from the template and moves when the template moves. Had
// a post stored a full copy of the style, "change a template and everything
// using it updates" would be false the moment anything was saved.
//
// The code defaults are the bottom layer rather than a repair for a broken row:
// a template written before a field existed simply has no such key, and
// inheriting the default is correct behaviour, not an error case.
//
// Pure and separate from image-recipe.ts, which is server-only because it
// touches the database. This half is where the rules live, so it can be tested.

// Only keys TemplateStyle has, and only values of the right kind.
//
// Both columns are jsonb, so anything could be in there: a hand-edited row, a
// field renamed in code but not in stored data, a half-written override. Merging
// blindly would put those straight into a render, where a wrong type reaches
// Satori as a broken layout rather than as an error.
export function cleanStyle(value: unknown): Partial<TemplateStyle> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const out: Partial<TemplateStyle> = {};

  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    if (!(key in raw)) continue;
    const candidate = raw[key];
    if (typeof candidate !== typeof fallback) continue;
    if (typeof candidate === "number" && !Number.isFinite(candidate)) continue;
    (out as Record<string, unknown>)[key] = candidate;
  }

  // ENUMS NEED THEIR OWN CHECK. The loop above only compares typeof, so any
  // string passes for scrim or font -- including a font that was removed from
  // the registry, or a typo in a hand-edited row. Satori would then silently
  // substitute a face and the picture would stop matching the preview.
  if (out.scrim && !["none", "black", "white"].includes(out.scrim)) {
    delete out.scrim;
  }
  if (out.font && !isFontId(out.font)) {
    delete out.font;
  }
  return out;
}

export function resolveStyle(
  template: unknown,
  overrides: unknown
): TemplateStyle {
  return { ...DEFAULTS, ...cleanStyle(template), ...cleanStyle(overrides) };
}

// A render is stale when the template has been edited since it was made. This is
// what a later slice reads to decide what to rebuild -- and note it can only
// ever rebuild drafts and scheduled posts. A published post's image is already
// on Instagram and Facebook, and nothing here can change that.
export function isStale(
  renderedPath: string | null,
  renderedAt: string | null,
  templateUpdatedAt: string
): boolean {
  if (!renderedPath || !renderedAt) return true;
  return renderedAt < templateUpdatedAt;
}
