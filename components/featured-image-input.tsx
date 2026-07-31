"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fieldInputClass } from "@/components/form-field";
import { uploadPostImage } from "@/lib/posts/image-upload";

// Featured image control: upload (picker or drop), preview, replace, remove,
// plus alt text once an image is set. The resolved public URL and the alt are
// mirrored into hidden inputs so they persist with the post on save. Remove
// clears both from the post (the storage object is left in place).
// onChange reports the current image and alt upward, so the SEO checklist can
// score them live rather than from the values this component was mounted with.
// The hidden inputs below are still what the form submits; this is a read-only
// mirror for anything that needs to react.
export function FeaturedImageInput({
  clientId,
  initialUrl,
  initialAlt,
  onChange,
}: {
  clientId: string;
  initialUrl: string | null;
  initialAlt: string | null;
  onChange?: (state: { url: string | null; alt: string }) => void;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [alt, setAlt] = useState(initialAlt ?? "");

  // Reported on every change rather than through an effect, so the parent never
  // renders a frame behind and no effect fires on mount for a value the parent
  // already has.
  const report = (next: { url?: string | null; alt?: string }) => {
    const merged = { url: next.url !== undefined ? next.url : url, alt: next.alt !== undefined ? next.alt : alt };
    if (next.url !== undefined) setUrl(next.url);
    if (next.alt !== undefined) setAlt(next.alt);
    onChange?.(merged);
  };
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Drop-target highlight. A counter rather than a boolean: dragging over a
  // child fires dragleave on the parent, so a boolean flickers off the moment
  // the pointer crosses the preview image or a button inside the zone.
  const [dragDepth, setDragDepth] = useState(0);
  const dragging = dragDepth > 0;

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const result = await uploadPostImage(file, clientId);
      if (result.ok) report({ url: result.url });
      else setError(result.error);
    } finally {
      setUploading(false);
    }
  }

  // One image, so a multi-file drop takes the first rather than silently
  // discarding the lot. A non-image drop (a PDF, a dragged link) is rejected
  // here with a message: uploadPostImage would reject it too, but "that is not
  // an image" is a better answer than a generic upload failure.
  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragDepth(0);
    if (uploading) return;
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(`${file.name}: not an image.`);
      return;
    }
    handleFile(file);
  }

  return (
    <div
      className="space-y-1.5"
      onDragEnter={(event) => {
        // Only for a real file drag. Selecting text and dragging it across the
        // form should not light up an upload target.
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragDepth((depth) => depth + 1);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        // Without this the browser navigates to the dropped file.
        event.preventDefault();
      }}
      onDragLeave={() => setDragDepth((depth) => Math.max(0, depth - 1))}
      onDrop={handleDrop}
    >
      <label className="text-sm font-medium">
        Featured image <span className="text-muted-foreground">(optional)</span>
      </label>
      <input type="hidden" name="featured_image" value={url ?? ""} />
      <input type="hidden" name="featured_image_alt" value={url ? alt : ""} />

      {url ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt=""
            className="h-40 w-full rounded-card border object-cover"
          />
          <div className="space-y-1">
            <label
              htmlFor="featured-image-alt"
              className="text-xs font-medium text-muted-foreground"
            >
              Alt text{" "}
              <span className="font-normal">
                (describes the image for screen readers and SEO)
              </span>
            </label>
            <input
              id="featured-image-alt"
              value={alt}
              onChange={(event) => report({ alt: event.target.value })}
              placeholder="e.g. A plumber fitting a tap in a Kent kitchen"
              className={fieldInputClass}
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : "Replace"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                report({ url: null });
                setAlt("");
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      ) : (
        /* The empty state IS the drop zone, so the target is visible before
           anything is dragged rather than appearing only once a drag starts.
           With an image already set the whole block still accepts a drop to
           replace it, which is why the handlers live on the wrapper above. */
        <div
          className={cn(
            "flex flex-col items-start gap-2 rounded-card border border-dashed p-4 transition-colors",
            dragging ? "border-primary bg-primary/5" : "bg-card/50"
          )}
        >
          <p className="text-sm text-muted-foreground">
            {dragging ? "Drop to upload" : "Drag an image here, or"}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? "Uploading…" : "Upload image"}
          </Button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleFile(file);
          event.target.value = "";
        }}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
