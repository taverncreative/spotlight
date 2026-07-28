import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import {
  CANVAS,
  DEFAULTS,
  fontsFor,
  templateElement,
  type RenderInput,
} from "@/lib/social/render-template";
import { fontOrDefault, weightOrDefault } from "@/lib/social/fonts";

// Slice 1: photo and text in, PNG out. No storage, no schema, no editor.
//
// Exists to answer one question -- can Satori plus a condensed face reproduce
// BSK's look -- before anything is built on top of the answer.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The photo must be a public object in Supabase storage.
//
// This route fetches a URL and returns what it renders, which is a server-side
// request forgery primitive if the host is a free parameter: point it at an
// internal address and the response comes back to you as pixels. Three
// conditions together are the mitigation -- https, a supabase.co host, and the
// public-object path -- and no internal or metadata address can satisfy them.
//
// SCOPED TO THE HOST FAMILY rather than to this project's own URL, which was the
// first attempt and was wrong in practice: a dev machine has
// NEXT_PUBLIC_SUPABASE_URL pointing at local Supabase, so pinning to it made it
// impossible to composite a production photo, which is exactly what verifying
// this slice needed. The looser rule gives up nothing that mattered -- someone
// else's public object is already public -- and keeps every address that could
// actually hurt out of reach.
function allowedPhoto(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!/(^|\.)supabase\.co$/.test(url.hostname)) return null;
  if (!url.pathname.startsWith("/storage/v1/object/public/")) return null;
  return url.toString();
}

// The null check is the whole point. Number(null) is 0, and 0 is finite, so a
// naive Number.isFinite guard silently turns every OMITTED parameter into zero
// rather than into its default -- which rendered the text at font-size 0 inside
// a zero-width box, i.e. a photo with no text on it and no error anywhere.
function num(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const photoUrl = allowedPhoto(params.get("photo") ?? "");
  if (!photoUrl) {
    return NextResponse.json(
      {
        error:
          "photo must be an https URL to a public object in this project's Supabase storage",
      },
      { status: 400 }
    );
  }

  // Pipes are accepted as line breaks so the whole thing stays typeable in a
  // browser address bar, which is the only editor slice 1 has.
  const text = (params.get("text") ?? "").replace(/\|/g, "\n").trim();
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  // Every field of TemplateStyle is addressable. Slice 2 stores these instead of
  // reading them off a query string; slice 3 puts controls on them. Nothing is
  // hard-coded here beyond the default.
  const scrimParam = params.get("scrim");
  const input: RenderInput = {
    photoUrl,
    text,
    scrim:
      scrimParam === "black" || scrimParam === "white" || scrimParam === "none"
        ? scrimParam
        : DEFAULTS.scrim,
    scrimOpacity: num(params.get("scrimOpacity"), DEFAULTS.scrimOpacity),
    font: fontOrDefault(params.get("font")).id,
    colour: params.get("colour") ?? DEFAULTS.colour,
    // Clamped to what the chosen face actually has a file for. Asking Satori
    // for a missing weight gets a silent substitution rather than an error, so
    // the picture would quietly stop matching the preview.
    weight: num(params.get("weight"), DEFAULTS.weight),
    x: num(params.get("x"), DEFAULTS.x),
    y: num(params.get("y"), DEFAULTS.y),
    width: num(params.get("width"), DEFAULTS.width),
    // capHeight is a fraction of canvas WIDTH; leading is a multiple of the cap
    // height. Both are quantities you can measure off a finished image, which is
    // the point -- see lib/social/render-template.tsx.
    capHeight: num(params.get("capHeight"), DEFAULTS.capHeight),
    leading: num(params.get("leading"), DEFAULTS.leading),
    highlight: params.get("highlight") === "1",
    highlightColour: params.get("highlightColour") ?? DEFAULTS.highlightColour,
    highlightOpacity: num(
      params.get("highlightOpacity"),
      DEFAULTS.highlightOpacity
    ),
    highlightPadX: num(params.get("highlightPadX"), DEFAULTS.highlightPadX),
    highlightPadY: num(params.get("highlightPadY"), DEFAULTS.highlightPadY),
  };

  const face = fontOrDefault(input.font);
  return new ImageResponse(templateElement(input), {
    width: CANVAS.width,
    height: CANVAS.height,
    fonts: await fontsFor(face, weightOrDefault(face, input.weight)),
  });
}
