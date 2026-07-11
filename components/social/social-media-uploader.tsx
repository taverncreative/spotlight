"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { socialMediaPublicUrl } from "@/lib/social/media-paths";
import {
  ALLOWED_MEDIA_TYPES,
  MAX_MEDIA_BYTES,
  SOCIAL_MEDIA_BUCKET,
  type SocialMediaItem,
} from "@/lib/social/schemas";

// A media item plus its derived preview URL (the row stores only the path).
export type UploaderItem = SocialMediaItem & { url: string };

async function readDimensions(
  file: File
): Promise<{ width: number | null; height: number | null }> {
  try {
    const bitmap = await createImageBitmap(file);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return { width: null, height: null };
  }
}

// Carousel uploader: add several images, reorder (earlier/later), remove. The
// first item is the cover. Dimensions are read client-side and stored with each
// row. Removed objects are reaped at save time (orphan cleanup in saveSocialPost).
export function SocialMediaUploader({
  clientId,
  postId,
  items,
  onChange,
}: {
  clientId: string;
  postId: string;
  items: UploaderItem[];
  onChange: (items: UploaderItem[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Uploads straight from the browser to the social-media bucket; storage RLS
  // (owns_client on the {client_id} folder) is the write gate. The server only
  // ever sees the returned paths, at save time.
  async function handleFiles(files: FileList) {
    setUploading(true);
    setError(null);
    const supabase = createClient();
    const added: UploaderItem[] = [];
    try {
      for (const file of Array.from(files)) {
        if (!ALLOWED_MEDIA_TYPES.includes(file.type)) {
          setError(
            `${file.name}: unsupported image type (use PNG, JPEG, WebP or GIF).`
          );
          continue;
        }
        if (file.size > MAX_MEDIA_BYTES) {
          setError(`${file.name}: image must be under 10 MB.`);
          continue;
        }
        const dims = await readDimensions(file);
        const ext = (file.name.split(".").pop() ?? "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        const path = `${clientId}/${postId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;
        try {
          const { error: uploadError } = await supabase.storage
            .from(SOCIAL_MEDIA_BUCKET)
            .upload(path, file, { contentType: file.type, upsert: false });
          if (uploadError) {
            setError(`${file.name}: upload failed.`);
            continue;
          }
        } catch {
          setError(`${file.name}: upload failed.`);
          continue;
        }
        added.push({
          storage_path: path,
          media_type: "image",
          width: dims.width,
          height: dims.height,
          url: socialMediaPublicUrl(path),
        });
      }
      onChange([...items, ...added]);
    } finally {
      setUploading(false);
    }
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const next = items.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">
        Photos{" "}
        <span className="text-muted-foreground">
          (carousel — first is the cover)
        </span>
      </label>

      {items.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((item, index) => (
            <li
              key={item.storage_path}
              className="relative overflow-hidden rounded-lg border bg-card"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.url}
                alt=""
                className="aspect-square w-full object-cover"
              />
              {index === 0 ? (
                <span className="absolute left-1 top-1 rounded bg-brand px-1.5 py-0.5 text-[0.65rem] font-medium text-brand-foreground">
                  Cover
                </span>
              ) : null}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-background/80 px-1 py-0.5 text-sm">
                <span className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label="Move earlier"
                    className="rounded px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === items.length - 1}
                    aria-label="Move later"
                    className="rounded px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    →
                  </button>
                </span>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  aria-label="Remove"
                  className="rounded px-1 text-destructive hover:underline"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
      >
        {uploading
          ? "Uploading…"
          : items.length > 0
            ? "Add more photos"
            : "Add photos"}
      </Button>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.length) handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
