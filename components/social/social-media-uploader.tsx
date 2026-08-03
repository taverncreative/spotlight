"use client";

import { useRef, useState } from "react";
import { Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { socialMediaPublicUrl } from "@/lib/social/media-paths";
import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_MEDIA_TYPES,
  MAX_IMAGE_BYTES,
  SOCIAL_MEDIA_BUCKET,
  type SocialMediaItem,
} from "@/lib/social/schemas";
import { checkVideo, isVideoType } from "@/lib/social/video-checks";
import {
  shouldUseResumable,
  uploadResumable,
} from "@/lib/social/resumable-upload";
import { grabPosterFrame, readVideoFacts } from "@/lib/social/video-probe";

// A media item plus its derived preview URL (the row stores only the path).
//
// posterUrl is what the grid actually renders for a video: an <img> pointed at
// a video file shows nothing, and every surface in the app renders media as an
// <img>.
export type UploaderItem = SocialMediaItem & {
  url: string;
  posterUrl?: string | null;
};

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
  onUploadingChange,
}: {
  clientId: string;
  postId: string;
  items: UploaderItem[];
  onChange: (items: UploaderItem[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  // Kept separate from error: a warning is about where the file can GO, not
  // whether it uploaded, and clearing it on the next success would hide the one
  // thing the operator needs to act on.
  const [warnings, setWarnings] = useState<string[]>([]);
  // Bytes, not files. A 111 MB video on the file counter reads as "Uploading
  // 1/1…" and a frozen screen for two minutes, which is indistinguishable from
  // a hang. Null when nothing large is in flight.
  const [bytes, setBytes] = useState<{ sent: number; total: number } | null>(
    null
  );
  const fileRef = useRef<HTMLInputElement>(null);
  // Drop-target highlight. A counter rather than a boolean: dragging over a
  // child fires dragleave on the parent, so a boolean flickers off the moment
  // the pointer crosses a thumbnail or a button inside the zone.
  const [dragDepth, setDragDepth] = useState(0);
  const dragging = dragDepth > 0;

  // Validate and upload one file; null means it was skipped (error shown).
  async function uploadOne(
    supabase: ReturnType<typeof createClient>,
    file: File
  ): Promise<UploaderItem | null> {
    if (!ALLOWED_MEDIA_TYPES.includes(file.type)) {
      setError(
        `${file.name}: unsupported file (use PNG, JPEG, WebP, GIF, MP4 or MOV).`
      );
      return null;
    }
    return isVideoType(file.type)
      ? uploadVideo(supabase, file)
      : uploadImage(supabase, file);
  }

  async function put(
    supabase: ReturnType<typeof createClient>,
    path: string,
    body: Blob,
    contentType: string
  ): Promise<boolean> {
    try {
      const { error: uploadError } = await supabase.storage
        .from(SOCIAL_MEDIA_BUCKET)
        .upload(path, body, { contentType, upsert: false });
      return !uploadError;
    } catch {
      return false;
    }
  }

  // The large-file path. Chunked, retried, and reporting bytes.
  //
  // TUS is a bare HTTP protocol with no Supabase client wrapped around it, so
  // the session token has to be fetched and passed explicitly -- the plain
  // upload gets this for free from the browser client.
  async function putResumable(
    supabase: ReturnType<typeof createClient>,
    path: string,
    file: File
  ): Promise<boolean> {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) {
      setError("Your session expired. Reload the page and try again.");
      return false;
    }
    try {
      await uploadResumable({
        accessToken,
        apiKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        path,
        file,
        onProgress: ({ sent, total }) => setBytes({ sent, total }),
      });
      return true;
    } catch (uploadError) {
      // SURFACE IT. The previous version caught and discarded this, so a failed
      // upload said only "upload failed" -- which is exactly as useful as
      // silence, and made the first real failure impossible to diagnose from
      // either end. TUS errors carry the server's response text, which is where
      // the actual cause lives.
      const detail =
        uploadError instanceof Error
          ? uploadError.message
          : String(uploadError);
      setError(`${file.name}: ${detail}`);
      // Also to the console, because the on-screen message gets truncated and
      // the full response body is what identifies an auth problem.
      console.error("[resumable upload]", uploadError);
      return false;
    } finally {
      setBytes(null);
    }
  }

  function pathFor(file: File, id: string): string {
    const ext = (file.name.split(".").pop() ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return `${clientId}/${postId}/${id}${ext ? `.${ext}` : ""}`;
  }

  async function uploadImage(
    supabase: ReturnType<typeof createClient>,
    file: File
  ): Promise<UploaderItem | null> {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setError(`${file.name}: unsupported image type.`);
      return null;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`${file.name}: image must be under 10 MB.`);
      return null;
    }
    const dims = await readDimensions(file);
    const path = pathFor(file, crypto.randomUUID());
    if (!(await put(supabase, path, file, file.type))) {
      setError(`${file.name}: upload failed.`);
      return null;
    }
    return {
      storage_path: path,
      media_type: "image",
      width: dims.width,
      height: dims.height,
      poster_path: null,
      url: socialMediaPublicUrl(path),
    };
  }

  // CHECKED BEFORE A BYTE IS SENT. The whole point of reading the file locally
  // is that a 150 MB upload followed by a Graph rejection three minutes into a
  // cron is the worst possible way to learn a video is two seconds too short.
  async function uploadVideo(
    supabase: ReturnType<typeof createClient>,
    file: File
  ): Promise<UploaderItem | null> {
    const facts = await readVideoFacts(file);
    const { blocking, warnings: found } = checkVideo(facts);
    if (blocking.length > 0) {
      setError(`${file.name}: ${blocking.join(" ")}`);
      return null;
    }
    // Shown, not swallowed, and the upload proceeds: these are Reels rules and
    // the file may be destined for the feed.
    if (found.length > 0) {
      setWarnings((current) => [
        ...current,
        `${file.name}: ${found.join(" ")}`,
      ]);
    }

    const id = crypto.randomUUID();
    const path = pathFor(file, id);
    // Above the threshold the plain upload is one long request that fails whole
    // on any wobble -- which is exactly how a 111 MB video was lost.
    const resumable = shouldUseResumable(file);
    const ok = resumable
      ? await putResumable(supabase, path, file)
      : await put(supabase, path, file, file.type);
    if (!ok) {
      // putResumable has already set a message with the real reason; only the
      // plain path needs a generic one, and overwriting the detailed message
      // here is what hid the cause the first time.
      if (!resumable) setError(`${file.name}: upload failed.`);
      return null;
    }

    // The poster is best effort and is uploaded AFTER the video. A missing
    // thumbnail is a worse-looking list; refusing the video over it would be the
    // tail wagging the dog.
    let posterPath: string | null = null;
    const poster = await grabPosterFrame(file);
    if (poster) {
      const candidate = `${clientId}/${postId}/${id}.poster.jpg`;
      if (await put(supabase, candidate, poster, "image/jpeg")) {
        posterPath = candidate;
      }
    }

    return {
      storage_path: path,
      media_type: "video",
      width: facts.width || null,
      height: facts.height || null,
      poster_path: posterPath,
      url: socialMediaPublicUrl(path),
      posterUrl: posterPath ? socialMediaPublicUrl(posterPath) : null,
    };
  }

  // Uploads straight from the browser to the social-media bucket; storage RLS
  // (owns_client on the {client_id} folder) is the write gate. The server only
  // ever sees the returned paths, at save time. Each finished file lands in the
  // grid immediately (per-file done state); the button counts them off.
  async function handleFiles(files: FileList) {
    const list = Array.from(files);
    setUploading(true);
    onUploadingChange?.(true);
    setProgress({ done: 0, total: list.length });
    setError(null);
    const supabase = createClient();
    let current = items;
    try {
      for (const file of list) {
        const item = await uploadOne(supabase, file);
        setProgress((p) => ({ done: p.done + 1, total: p.total }));
        if (item) {
          current = [...current, item];
          onChange(current);
        }
      }
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
    }
  }

  // A drop goes through the SAME handleFiles as the picker, so every validation
  // the picker enforces -- type, size, the video checks that run before a byte
  // is sent -- applies identically. A dropped file is not a trusted file.
  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragDepth(0);
    if (uploading) return;
    if (event.dataTransfer.files?.length) handleFiles(event.dataTransfer.files);
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
    <div
      className="space-y-1.5"
      onDragEnter={(event) => {
        // Only for a real file drag. Reordering thumbnails or dragging selected
        // caption text across the composer must not light up an upload target.
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
              className="relative overflow-hidden rounded-card border bg-card"
            >
              {/* A video renders its POSTER. An <img> pointed at an mp4 shows
                  a broken image, and every surface in this app -- card, grid,
                  calendar tile, day detail -- renders media as an <img>. */}
              {item.media_type === "video" && !item.posterUrl ? (
                <div className="flex aspect-square w-full items-center justify-center bg-muted text-center text-[0.65rem] text-muted-foreground">
                  Video
                  <br />
                  no preview
                </div>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={item.posterUrl ?? item.url}
                  alt=""
                  className="aspect-square w-full object-cover"
                />
              )}
              {item.media_type === "video" ? (
                <span className="absolute right-1 top-1 rounded bg-background/80 px-1.5 py-0.5 text-[0.65rem] font-medium">
                  <Video aria-hidden="true" className="inline size-3" />
                </span>
              ) : null}
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

      {/* The drop zone wraps the button rather than replacing it, so the picker
          stays exactly where it was and dropping is the addition. Dashed only
          when empty: once there are thumbnails the grid above is the visible
          target and a second dashed box below it is noise. */}
      <div
        className={cn(
          "flex flex-col items-start gap-2 transition-colors",
          items.length === 0 && "rounded-card border border-dashed p-4",
          items.length === 0 && !dragging && "bg-card/50",
          dragging &&
            "rounded-card border border-dashed border-primary bg-primary/5 p-4"
        )}
      >
        <p className="text-sm text-muted-foreground">
          {dragging
            ? "Drop to upload"
            : items.length === 0
              ? "Drag photos or a video here, or"
              : "Drag more here, or"}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading
            ? bytes
              ? `Uploading ${Math.round((bytes.sent / bytes.total) * 100)}% of ${Math.round(bytes.total / (1024 * 1024))} MB…`
              : `Uploading ${progress.done}/${progress.total}…`
            : items.length > 0
              ? "Add more"
              : "Add photos or video"}
        </Button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={ALLOWED_MEDIA_TYPES.join(",")}
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.length) handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {/* The bar is the honest part: a percentage that ticks proves the upload
          is alive, which is the whole complaint a one-long-request upload could
          not answer. */}
      {bytes ? (
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={Math.round((bytes.sent / bytes.total) * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Upload progress"
        >
          <div
            className="h-full bg-primary transition-[width] duration-200"
            style={{ width: `${(bytes.sent / bytes.total) * 100}%` }}
          />
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {/* Separate from the error, and deliberately not cleared by a later
          success: a warning is about where the file can GO, not whether it
          uploaded, and it is the one thing the operator still has to act on. */}
      {warnings.length > 0 ? (
        <ul className="space-y-0.5">
          {warnings.map((warning) => (
            <li key={warning} className="text-xs text-status-warn">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
