"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { uploadPostImage } from "@/lib/posts/image-upload";

// Featured image control: upload, preview, replace, remove. The resolved public
// URL is mirrored into a hidden input so it persists with the post on save.
// Remove clears the URL from the post (the storage object is left in place).
export function FeaturedImageInput({
  clientId,
  initialUrl,
}: {
  clientId: string;
  initialUrl: string | null;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const result = await uploadPostImage(file, clientId);
      if (result.ok) setUrl(result.url);
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

      {url ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt=""
            className="h-40 w-full rounded-card border object-cover"
          />
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
              onClick={() => setUrl(null)}
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
