import "server-only";
import { ImageResponse } from "next/og";
import {
  CANVAS,
  fontsFor,
  templateElement,
} from "@/lib/social/render-template";
import { fontOrDefault, weightOrDefault } from "@/lib/social/fonts";
import type { RenderInput } from "@/lib/social/render-template-style";

// Rasterising a recipe and putting the result where the publisher can find it.
//
// THE renderer, and now the only one. It used to have a sibling at
// /api/render/social, which streamed the same image back so the editor's "See
// the real render" button could show the true output before committing to it.
// Both are gone: Save now renders as part of saving, so the picture on the post
// IS the check, and a second entry point into the same renderer was one more
// thing that could drift from this one.

export async function renderToPng(input: RenderInput): Promise<Buffer> {
  const face = fontOrDefault(input.font);
  const image = new ImageResponse(templateElement(input), {
    width: CANVAS.width,
    height: CANVAS.height,
    fonts: await fontsFor(face, weightOrDefault(face, input.weight)),
  });
  return Buffer.from(await image.arrayBuffer());
}

export { isRenderPath, renderPath } from "@/lib/social/render-to-storage-paths";
