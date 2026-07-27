"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldInputClass } from "@/components/form-field";
import { uploadPostImage } from "@/lib/posts/image-upload";

// Featured image control: upload, preview, replace, remove, plus alt text once
// an image is set. The resolved public URL and the alt are mirrored into hidden
// inputs so they persist with the post on save. Remove clears both from the
// post (the storage object is left in place).
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

  return (
    <div className="space-y-1.5">
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading…" : "Upload image"}
        </Button>
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
