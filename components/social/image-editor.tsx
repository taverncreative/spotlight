"use client";

import { useActionState, useState } from "react";
import localFont from "next/font/local";
import { Button } from "@/components/ui/button";
import { fieldInputClass } from "@/components/form-field";
import { cn } from "@/lib/utils";
import { socialMediaPublicUrl } from "@/lib/social/media-paths";
import { resolveStyle } from "@/lib/social/image-style";
import {
  canvasFor,
  type ScrimColour,
  type TemplateStyle,
} from "@/lib/social/render-template-style";
import {
  FONTS,
  FONT_IDS,
  fontOrDefault,
  weightOrDefault,
  weightsOf,
  type FontId,
} from "@/lib/social/fonts";
import {
  saveAndRenderImageRecipe,
  type ImageRecipeState,
} from "@/lib/social/image-actions";
import type { PostFormat } from "@/lib/social/schemas";
import {
  TemplateControls,
  type ControlTemplate,
} from "@/components/social/template-controls";

// THE PREVIEW IS CSS, NOT SATORI, and that is a reversal of what the recon
// recommended. The recon was right for a general template engine and wrong for
// this one, because the template shape removed the reasons:
//
//   * every line is its own div with whiteSpace: pre, so nothing wraps, and
//     wrapping is where Satori and a browser most visibly disagree
//   * vertical layout comes entirely from OUR numbers -- capHeight sets the font
//     size through CAP_OVER_EM, leading sets the line box -- so both engines are
//     applying the same arithmetic rather than each deciding for themselves
//   * the browser loads the SAME Anton file the renderer embeds, so glyph
//     advances match, and advances are all that set the ragged highlight edge
//
// What is left to drift is sub-pixel rounding, against roughly a megabyte of
// Satori and a WASM layout engine in the page. The trade only holds while those
// three conditions hold: add wrapping, auto-fitting, or a second font that the
// browser does not have, and this becomes an approximation again.
//
// "See the real render" is next to Save so drift is checkable rather than
// assumed.
// One declaration per family, from the same files lib/social/fonts.ts gives the
// renderer. next/font/local needs literal paths at build time, so this list
// cannot be generated from the registry -- which makes it the one place the two
// could drift. Record<FontId, ...> is what stops it: adding a face to the
// registry fails the build here until it is declared, so the preview can never
// be missing a font the renderer has.
const anton = localFont({
  src: "../../assets/fonts/Anton-Regular.ttf",
  weight: "400",
  display: "block",
});
const oswald = localFont({
  src: [
    { path: "../../assets/fonts/Oswald-Regular.ttf", weight: "400" },
    { path: "../../assets/fonts/Oswald-Bold.ttf", weight: "700" },
  ],
  display: "block",
});
const bebas = localFont({
  src: "../../assets/fonts/BebasNeue-Regular.ttf",
  weight: "400",
  display: "block",
});
const archivo = localFont({
  src: [
    { path: "../../assets/fonts/ArchivoNarrow-Regular.ttf", weight: "400" },
    { path: "../../assets/fonts/ArchivoNarrow-Bold.ttf", weight: "700" },
  ],
  display: "block",
});

const archivoBlack = localFont({
  src: "../../assets/fonts/ArchivoBlack-Regular.ttf",
  weight: "400",
  display: "block",
});
const alfaSlab = localFont({
  src: "../../assets/fonts/AlfaSlabOne-Regular.ttf",
  weight: "400",
  display: "block",
});
const abril = localFont({
  src: "../../assets/fonts/AbrilFatface-Regular.ttf",
  weight: "400",
  display: "block",
});
const playfair = localFont({
  src: [
    { path: "../../assets/fonts/PlayfairDisplay-Bold.ttf", weight: "700" },
    { path: "../../assets/fonts/PlayfairDisplay-Black.ttf", weight: "900" },
  ],
  display: "block",
});
const spaceGrotesk = localFont({
  src: [
    { path: "../../assets/fonts/SpaceGrotesk-Regular.ttf", weight: "400" },
    { path: "../../assets/fonts/SpaceGrotesk-Bold.ttf", weight: "700" },
  ],
  display: "block",
});

export const PREVIEW_FONTS: Record<FontId, { className: string }> = {
  anton,
  oswald,
  "bebas-neue": bebas,
  "archivo-narrow": archivo,
  "archivo-black": archivoBlack,
  "alfa-slab-one": alfaSlab,
  "abril-fatface": abril,
  "playfair-display": playfair,
  "space-grotesk": spaceGrotesk,
};

export type EditorTemplate = ControlTemplate;

export type EditorPhoto = { storagePath: string };

// One id for the editor's own form, shared by its fields and its Save button.
// A constant rather than a literal in seven places, because a typo in one of
// them would silently drop that field from the submission.
const EDITOR_FORM = "image-editor-form";

const SWATCHES = ["#111111", "#FFFFFF"];

export function ImageEditor({
  clientSlug,
  postId,
  templates,
  photos,
  initial,
  format = "feed",
}: {
  clientSlug: string;
  postId: string;
  templates: EditorTemplate[];
  photos: EditorPhoto[];
  initial: {
    recipeId: string | null;
    templateId: string | null;
    photoPath: string | null;
    text: string;
    overrides: Partial<TemplateStyle>;
  };
  // Which canvas this post renders on. A story is 9:16, a feed post 4:5, and
  // the preview has to be the one the post will actually be published at.
  format?: PostFormat;
}) {
  const [state, formAction, pending] = useActionState<
    ImageRecipeState,
    FormData
  >(saveAndRenderImageRecipe, null);

  const [templateId, setTemplateId] = useState(
    initial.templateId ?? templates[0]?.id ?? ""
  );
  const [photoPath, setPhotoPath] = useState(
    initial.photoPath ?? photos[0]?.storagePath ?? ""
  );
  const [text, setText] = useState(initial.text);

  const template = templates.find((t) => t.id === templateId) ?? templates[0];

  // The editor works with a fully RESOLVED style because it has to draw
  // something. What gets stored is the diff against the template, worked out
  // server-side -- see image-actions.ts. Storing the resolved copy would freeze
  // every value nobody touched and quietly detach the post from its template.
  const [style, setStyle] = useState<TemplateStyle>(() =>
    resolveStyle(template?.style ?? {}, initial.overrides)
  );
  const set = <K extends keyof TemplateStyle>(
    key: K,
    value: TemplateStyle[K]
  ) => setStyle((current) => ({ ...current, [key]: value }));

  // Preview geometry. Everything is a fraction of the canvas, so drawing at any
  // display width is exact rather than a scaled approximation.
  //
  // THE CANVAS COMES FROM THE FORMAT. A story is 9:16 and a feed post is 4:5,
  // and previewing a story on the feed canvas is precisely the bug this fixes:
  // words that sat inside a 4:5 frame here were cropped away by Instagram.
  const canvas = canvasFor(format);

  // The source photo's own size, read off the loaded image. Needed to show what
  // the frame CROPS: the renderer covers the canvas with the photo, so anything
  // outside the frame is thrown away, and until now the editor simply never drew
  // it. Null until the image loads, and the preview falls back to the frame
  // alone, which is what it always used to be.
  const [photoSize, setPhotoSize] = useState<{ w: number; h: number } | null>(
    null
  );

  // MEASURED VIA A REF, NOT ONLY onLoad. A cached image is already complete by
  // the time React hydrates, so its load event has come and gone and an onLoad
  // handler never fires -- which left the preview believing every photo fitted
  // the frame exactly. The ref runs on mount and on every photo change, reads
  // the size immediately when the image is already decoded, and falls back to
  // the load event when it is not.
  const measure = (node: HTMLImageElement | null) => {
    if (!node) return;
    const take = () => {
      if (node.naturalWidth > 0 && node.naturalHeight > 0) {
        setPhotoSize((current) =>
          current?.w === node.naturalWidth && current?.h === node.naturalHeight
            ? current
            : { w: node.naturalWidth, h: node.naturalHeight }
        );
      }
    };
    if (node.complete) take();
    else node.addEventListener("load", take, { once: true });
  };

  // The frame's display width, and a CEILING ON THE WHOLE PREVIEW.
  //
  // Drawing the cropped-away area means the outer box is the size of the whole
  // photo at cover scale, and for a wide landscape into a 9:16 frame that is
  // roughly three times the frame's width. Left unbounded it pushed the preview
  // column past a thousand pixels and squashed the controls beside it.
  //
  // So the frame shrinks until the whole picture fits the ceiling, rather than
  // the overflow being clipped. Clipping would hide exactly the thing this is
  // here to show.
  const FRAME_W = 340;
  // Chosen so a NORMAL photo never shrinks the frame at all: a 4:5 or portrait
  // source into either canvas fits inside these, so fit stays 1 and the frame is
  // the full 340. Only a wide landscape into 9:16 -- where the crop is severe
  // and worth seeing -- trades frame size for showing what is lost.
  const OUTER_MAX_W = 520;
  const OUTER_MAX_H = 660;
  const frameH0 = (FRAME_W * canvas.height) / canvas.width;
  const fit = (() => {
    if (!photoSize || photoSize.w <= 0 || photoSize.h <= 0) return 1;
    const scale = Math.max(FRAME_W / photoSize.w, frameH0 / photoSize.h);
    return Math.min(
      1,
      OUTER_MAX_W / (photoSize.w * scale),
      OUTER_MAX_H / (photoSize.h * scale)
    );
  })();
  const W = Math.round(FRAME_W * fit);
  const H = Math.round((W * canvas.height) / canvas.width);

  const face = fontOrDefault(style.font);
  const weight = weightOrDefault(face, style.weight);
  const capPx = style.capHeight * W;
  // The FACE's ratio. They range from 0.686 to 0.859, so using one number for
  // all of them is a wrong size rather than a rounding difference.
  const fontSize = capPx / face.capOverEm;
  const padX = style.highlight ? style.highlightPadX * capPx : 0;
  const padY = style.highlight ? style.highlightPadY * capPx : 0;
  const lines = text.split("\n");

  const photoUrl = photoPath ? socialMediaPublicUrl(photoPath) : null;

  // The same object-fit: cover arithmetic the renderer does, worked out here so
  // the crop can be DRAWN rather than described. Scale so the photo covers the
  // frame; whichever axis overflows is what gets cut.
  const cover = (() => {
    if (!photoSize || photoSize.w <= 0 || photoSize.h <= 0) {
      return { drawnW: W, drawnH: H, frameLeft: 0, frameTop: 0, crops: false };
    }
    const scale = Math.max(W / photoSize.w, H / photoSize.h);
    const drawnW = photoSize.w * scale;
    const drawnH = photoSize.h * scale;
    return {
      drawnW,
      drawnH,
      frameLeft: (drawnW - W) / 2,
      frameTop: (drawnH - H) / 2,
      // A pixel of slack, so a photo that is already the right shape does not
      // claim to be cropped because of rounding.
      crops: drawnW - W > 1 || drawnH - H > 1,
    };
  })();

  const scrimRgba =
    style.scrim === "none"
      ? null
      : style.scrim === "black"
        ? `rgba(0,0,0,${style.scrimOpacity})`
        : `rgba(255,255,255,${style.scrimOpacity})`;

  return (
    // NOTHING HERE WRAPS ANYTHING ELSE IN A <form>, and that is the point.
    //
    // This used to be <form action={...}> around the whole editor, which meant
    // the template controls' own forms were nested inside it. React does not
    // dispatch an action for a nested form -- it says so in the console, "<form>
    // cannot contain a nested <form>" -- so those buttons fired a submit event
    // and ran nothing. That killed "Render onto the post", and it had silently
    // killed Duplicate, Save as new and Update too.
    //
    // So every form on this screen is now an EMPTY, top-level element, and the
    // fields and buttons that belong to it point at it by id. One rule, applied
    // the same way everywhere, and no form can contain another because none of
    // them contain anything at all.
    <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
      {/* hidden is load-bearing, not tidiness. A <form> is display:block, so
          without it this empty element becomes a GRID ITEM holding the first
          cell, which pushes the preview and the controls along by one and
          reorders the layout. The hidden inputs below never did that, because
          display:none keeps an element out of the grid entirely -- this now
          behaves the same way they do. */}
      <form id={EDITOR_FORM} action={formAction} className="hidden" />
      <input type="hidden" form={EDITOR_FORM} name="post_id" value={postId} />
      <input
        type="hidden"
        form={EDITOR_FORM}
        name="client_slug"
        value={clientSlug}
      />
      <input
        type="hidden"
        form={EDITOR_FORM}
        name="recipe_id"
        value={initial.recipeId ?? ""}
      />
      <input
        type="hidden"
        form={EDITOR_FORM}
        name="template_id"
        value={templateId}
      />
      <input
        type="hidden"
        form={EDITOR_FORM}
        name="photo_path"
        value={photoPath}
      />
      <input type="hidden" form={EDITOR_FORM} name="text" value={text} />
      <input
        type="hidden"
        form={EDITOR_FORM}
        name="style"
        value={JSON.stringify(style)}
      />

      {/* --- preview ---
          WHAT YOU SEE IS WHAT GOES OUT, which it previously was not.
          The outer box is the whole PHOTO at the scale the renderer will use.
          The inner box is the CANVAS -- the actual output -- and everything
          between them is what the crop throws away, drawn faded so it reads as
          outside rather than missing. Words are placed inside the inner box, so
          a headline that looks safe here is safe in the app. */}
      <div className="space-y-2">
        <div
          className="relative mx-auto"
          style={{ width: cover.drawnW, height: cover.drawnH }}
        >
          {photoUrl ? (
            <>
              {/* The cropped-away area. Same photo, same scale, faded. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={photoPath}
                ref={measure}
                src={photoUrl}
                alt=""
                className="absolute top-0 left-0 opacity-25 grayscale"
                style={{ width: cover.drawnW, height: cover.drawnH }}
              />
            </>
          ) : null}

          {/* THE FRAME: exactly the pixels that get published. */}
          <div
            className="absolute overflow-hidden rounded-card bg-muted ring-2 ring-primary"
            style={{
              left: cover.frameLeft,
              top: cover.frameTop,
              width: W,
              height: H,
            }}
          >
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt=""
                className="absolute max-w-none"
                style={{
                  left: -cover.frameLeft,
                  top: -cover.frameTop,
                  width: cover.drawnW,
                  height: cover.drawnH,
                  // Until the natural size is known, drawnW/drawnH ARE the frame,
                  // so cover keeps the picture's shape instead of stretching it
                  // to fill. Once measured the box already matches the image and
                  // this does nothing.
                  objectFit: "cover",
                }}
              />
            ) : (
              <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                No photo on this post yet
              </div>
            )}
            {scrimRgba ? (
              <div
                className="absolute inset-0"
                style={{ backgroundColor: scrimRgba }}
              />
            ) : null}
            <div
              className="absolute flex flex-col items-start"
              style={{
                left: style.x * W - padX,
                top: style.y * H,
                width: style.width * W + padX * 2,
              }}
            >
              {lines.map((line, index) => (
                <div
                  key={index}
                  className={PREVIEW_FONTS[face.id].className}
                  style={{
                    fontSize,
                    fontWeight: weight,
                    lineHeight: (style.leading * capPx) / fontSize,
                    color: style.colour,
                    textTransform: "uppercase",
                    whiteSpace: "pre",
                    paddingLeft: padX,
                    paddingRight: padX,
                    paddingTop: padY,
                    paddingBottom: padY,
                    marginTop: -padY,
                    marginBottom: -padY,
                    backgroundColor: style.highlight
                      ? hexToRgba(style.highlightColour, style.highlightOpacity)
                      : undefined,
                  }}
                >
                  {line === "" ? " " : line}
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Output is {canvas.width}&times;{canvas.height}
          {format === "story" ? " (9:16)" : " (4:5)"}.{" "}
          {cover.crops
            ? "The faded area is cropped off and will not be published."
            : "This photo fits the frame exactly."}
        </p>
      </div>

      {/* --- controls --- */}
      <div className="space-y-4">
        <Field label="Headline">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={5}
            placeholder={"MORE\nWEBSITE\nTRAFFIC"}
            className={cn(fieldInputClass, "font-mono text-sm")}
          />
          <Hint>
            One line per line. The breaks are yours and are never re-wrapped.
          </Hint>
        </Field>

        <TemplateControls
          templates={templates}
          templateId={templateId}
          style={style}
          clientSlug={clientSlug}
          postId={postId}
          onPick={(id, templateStyle) => {
            setTemplateId(id);
            // Re-resolve from the picked template with NO overrides. Carrying
            // the previous template's values across would mean switching
            // template appeared to do nothing.
            setStyle(resolveStyle(templateStyle, {}));
          }}
        />

        {photos.length > 0 ? (
          <Field label="Photo">
            <div className="flex flex-wrap gap-2">
              {photos.map((photo) => (
                <button
                  key={photo.storagePath}
                  type="button"
                  onClick={() => setPhotoPath(photo.storagePath)}
                  className={cn(
                    "size-14 overflow-hidden rounded-md border-2",
                    photo.storagePath === photoPath
                      ? "border-primary"
                      : "border-transparent"
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={socialMediaPublicUrl(photo.storagePath)}
                    alt=""
                    className="size-full object-cover"
                  />
                </button>
              ))}
            </div>
            <Hint>Photos already uploaded to this post.</Hint>
          </Field>
        ) : (
          <Hint>
            Upload a photo to this post first, then come back and place the
            words on it.
          </Hint>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Slider
            label="Size"
            value={style.capHeight}
            min={0.05}
            max={0.25}
            step={0.001}
            onChange={(v) => set("capHeight", v)}
          />
          <Slider
            label="Leading"
            value={style.leading}
            min={0.85}
            max={1.6}
            step={0.01}
            onChange={(v) => set("leading", v)}
          />
          <Slider
            label="Across"
            value={style.x}
            min={0}
            max={0.6}
            step={0.002}
            onChange={(v) => set("x", v)}
          />
          <Slider
            label="Down"
            value={style.y}
            min={0}
            max={0.85}
            step={0.002}
            onChange={(v) => set("y", v)}
          />
        </div>

        <Field label="Font">
          <select
            value={face.id}
            onChange={(event) => {
              const next = fontOrDefault(event.target.value);
              setStyle((current) => ({
                ...current,
                font: next.id,
                // Clamp, because the new face may not have the old weight and
                // Satori would silently substitute rather than fail.
                weight: weightOrDefault(next, current.weight),
              }));
            }}
            className={fieldInputClass}
          >
            {FONT_IDS.map((id) => (
              <option key={id} value={id}>
                {FONTS[id].family}
              </option>
            ))}
          </select>
          <Hint>{face.note}</Hint>
          {/* The same kind of warning "Update template" gives, and for the same
              reason: this changes something the eye will not predict. */}
          <p className="text-xs text-status-warn">
            Changing the font changes every line&rsquo;s width. Highlights will
            shift, and line breaks that only just fitted may not.
          </p>
        </Field>

        {weightsOf(face).length > 1 ? (
          <Field label="Weight">
            <select
              value={weight}
              onChange={(event) => set("weight", Number(event.target.value))}
              className={fieldInputClass}
            >
              {weightsOf(face).map((option) => (
                <option key={option} value={option}>
                  {option === 900
                    ? "Black"
                    : option === 700
                      ? "Bold"
                      : "Regular"}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Hint>{FONTS[face.id].family} has one weight.</Hint>
        )}

        <Field label="Text colour">
          <Swatches value={style.colour} onChange={(v) => set("colour", v)} />
        </Field>

        <Field label="Highlight">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={style.highlight}
              onChange={(event) => set("highlight", event.target.checked)}
            />
            Block behind the words
          </label>
          {style.highlight ? (
            <div className="mt-2 space-y-2">
              <Swatches
                value={style.highlightColour}
                onChange={(v) => set("highlightColour", v)}
              />
              <Slider
                label="Opacity"
                value={style.highlightOpacity}
                min={0.2}
                max={1}
                step={0.05}
                onChange={(v) => set("highlightOpacity", v)}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Slider
                  label="Padding across"
                  value={style.highlightPadX}
                  min={0}
                  max={0.4}
                  step={0.01}
                  onChange={(v) => set("highlightPadX", v)}
                />
                <Slider
                  label="Padding down"
                  value={style.highlightPadY}
                  min={0}
                  max={0.3}
                  step={0.01}
                  onChange={(v) => set("highlightPadY", v)}
                />
              </div>
              <Hint>
                Vertical padding grows the blocks without moving the text: the
                line pitch stays exactly where the Leading slider put it.
              </Hint>
            </div>
          ) : null}
        </Field>

        <Field label="Scrim">
          <select
            value={style.scrim}
            onChange={(event) =>
              set("scrim", event.target.value as ScrimColour)
            }
            className={fieldInputClass}
          >
            <option value="none">None</option>
            <option value="black">Black</option>
            <option value="white">White</option>
          </select>
          {style.scrim !== "none" ? (
            <div className="mt-2">
              <Slider
                label="Opacity"
                value={style.scrimOpacity}
                min={0.05}
                max={0.85}
                step={0.05}
                onChange={(v) => set("scrimOpacity", v)}
              />
            </div>
          ) : null}
          <Hint>Dims the whole photo. The highlight usually beats it.</Hint>
        </Field>

        {/* Success never renders here: it redirects to the post. So the only
            thing this space has to say is what went wrong, and whether the
            settings survived it. */}
        {state?.error ? (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
            {state.saved ? (
              <>
                {" "}
                Your settings are saved, so nothing is lost - press Save again
                to retry the picture.
              </>
            ) : null}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          {/* ONE BUTTON. It saves the recipe, renders it, attaches the picture
              to the post and goes back to the post -- one intention, one act,
              instead of three steps where the middle one was easy to forget. */}
          <Button
            type="submit"
            form={EDITOR_FORM}
            size="sm"
            disabled={pending || !photoPath}
          >
            {pending ? "Saving and rendering…" : "Save"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Renders the picture onto the post, replacing whatever is in that
            slot.
          </p>
        </div>
      </div>
    </div>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const value = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(value))
    return `rgba(255,255,255,${alpha})`;
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex items-baseline justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {value.toFixed(3)}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full"
      />
    </label>
  );
}

function Swatches({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {SWATCHES.map((swatch) => (
        <button
          key={swatch}
          type="button"
          onClick={() => onChange(swatch)}
          aria-label={swatch}
          className={cn(
            "size-7 rounded-md border-2",
            value.toUpperCase() === swatch ? "border-primary" : "border-border"
          )}
          style={{ backgroundColor: swatch }}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        className="h-7 w-10 cursor-pointer rounded-md border bg-transparent"
        aria-label="Custom colour"
      />
    </div>
  );
}
