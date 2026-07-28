import "server-only";
import { ImageResponse } from "next/og";
import {
  CANVAS,
  FONT_NAME,
  loadFont,
  templateElement,
} from "@/lib/social/render-template";
import type { RenderInput } from "@/lib/social/render-template-style";

// Rasterising a recipe and putting the result where the publisher can find it.
//
// Same renderer as /api/render/social. That route exists so the editor can show
// the true output on demand; this is the same call with the bytes kept instead
// of streamed, so there is one renderer rather than two that can drift.

export async function renderToPng(input: RenderInput): Promise<Buffer> {
  const image = new ImageResponse(templateElement(input), {
    width: CANVAS.width,
    height: CANVAS.height,
    fonts: [
      { name: FONT_NAME, data: await loadFont(), weight: 400, style: "normal" },
    ],
  });
  return Buffer.from(await image.arrayBuffer());
}

export { isRenderPath, renderPath } from "@/lib/social/render-to-storage-paths";
