"use client";

import { useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fieldInputClass } from "@/components/form-field";
import { uploadPostImage } from "@/lib/posts/image-upload";
import { unsplashSearchUrl } from "@/lib/posts/unsplash";

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
  // The live focus keyword and title, for the Unsplash search link. Passed down
  // rather than mirrored here: they belong to the form, and a second copy would
  // be a second thing to keep in step.
  focusKeyword,
  title,
}: {
  clientId: string;
  initialUrl: string | null;
  initialAlt: string | null;
  onChange?: (state: { url: string | null; alt: string }) => void;
  focusKeyword?: string | null;
  title?: string | null;
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
            <UnsplashLink focusKeyword={focusKeyword} title={title} />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? "Uploading…" : "Upload image"}
          </Button>
          <UnsplashLink focusKeyword={focusKeyword} title={title} />
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

// Opens Unsplash pre-searched on the focus keyword, or the title if there is no
// keyword. A LINK, not an integration: you still download and upload, which is
// what keeps the image in the post-images bucket where og:image and the client
// templates expect it, and what keeps the Unsplash API's hotlinking and
// attribution requirements out of scope entirely. The licence itself asks for
// nothing.
//
// Disabled rather than hidden when there is nothing to search for, so the button
// does not appear and vanish as the title is typed. The hint says which field it
// is about to use, because "why did it search for that" is otherwise a mystery.
function UnsplashLink({
  focusKeyword,
  title,
}: {
  focusKeyword?: string | null;
  title?: string | null;
}) {
  const href = unsplashSearchUrl(focusKeyword ?? null, title ?? null);

  if (!href) {
    return (
      <span className="text-xs text-muted-foreground">
        Add a title or focus keyword to search Unsplash.
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      render={
        // noreferrer alongside noopener: this is an outbound link from a page
        // whose URL contains a client id.
        <a href={href} target="_blank" rel="noopener noreferrer" />
      }
    >
      Find on Unsplash
      <ExternalLink aria-hidden="true" className="size-3.5" />
    </Button>
  );
}
