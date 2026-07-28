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
// Same renderer as /api/render/social. That route exists so the editor can show
// the true output on demand; this is the same call with the bytes kept instead
// of streamed, so there is one renderer rather than two that can drift.

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
