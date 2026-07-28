import * as tus from "tus-js-client";
import { SOCIAL_MEDIA_BUCKET } from "@/lib/social/schemas";

// Resumable upload to Supabase storage, over TUS.
//
// WHY IT EXISTS. A real phone video came in at 111 MB. The plain upload is one
// long request: any wobble on a domestic connection and the whole thing is lost,
// with nothing to show for two minutes of waiting. It also gives no byte
// progress, so a 111 MB file reads as "Uploading 1/1…" and a frozen screen.
//
// VIDEO ONLY, ABOVE A NAMED THRESHOLD. Supabase recommends resumable above 6 MB,
// and a 200 KB JPEG through a chunked protocol is pure overhead for no benefit.
// So this is a second path rather than a replacement, and RESUMABLE_ABOVE_BYTES
// is the whole of the decision -- named, not buried in an inequality somewhere.
export const RESUMABLE_ABOVE_BYTES = 6 * 1024 * 1024; // 6 MB

// FIXED BY SUPABASE, not a tuning knob: their docs say 6 MB and "do not change
// it". A different value is rejected rather than merely slower.
const CHUNK_BYTES = 6 * 1024 * 1024;

export function shouldUseResumable(file: File): boolean {
  return file.size > RESUMABLE_ABOVE_BYTES;
}

export type UploadProgress = { sent: number; total: number };

export type ResumableOptions = {
  // The user's session JWT. NOT the publishable key: the plain client lets RLS
  // decide from the session cookie, but TUS is a bare HTTP protocol with no
  // Supabase client around it, so the bearer has to be passed explicitly.
  accessToken: string;
  // Sent alongside, because supabase-js always sends both and the storage API
  // expects it. Omitting it is an easy mistake to make from the TUS docs, which
  // only mention the bearer.
  apiKey: string;
  supabaseUrl: string;
  path: string;
  file: File;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
};

// The resumable endpoint lives on a DIFFERENT HOST from the REST API -- the
// storage subdomain, not the project one. Derived from the configured URL so
// there is nothing new to keep in an env file.
export function resumableEndpoint(supabaseUrl: string): string {
  const host = new URL(supabaseUrl).hostname;
  const project = host.split(".")[0];
  return `https://${project}.storage.supabase.co/storage/v1/upload/resumable`;
}

export function uploadResumable(options: ResumableOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(options.file, {
      endpoint: resumableEndpoint(options.supabaseUrl),
      // Supabase's storage policies still apply, on the same
      // {client_id}/{post_id}/… path as the plain upload. Nothing new to
      // authorise; only the way the bearer is supplied changes.
      headers: {
        authorization: `Bearer ${options.accessToken}`,
        apikey: options.apiKey,
        // Never overwrite. The paths carry a fresh uuid per upload, so a
        // collision would mean something is wrong rather than something needs
        // replacing.
        "x-upsert": "false",
      },
      chunkSize: CHUNK_BYTES,
      // The path is metadata here rather than part of the URL, which is the
      // main shape difference from the plain upload.
      metadata: {
        bucketName: SOCIAL_MEDIA_BUCKET,
        objectName: options.path,
        contentType: options.file.type,
        cacheControl: "3600",
      },
      // Retries are the point. These delays are the client's own backoff
      // between chunk attempts, so a brief drop costs seconds rather than the
      // whole file.
      retryDelays: [0, 1000, 3000, 5000, 10000],
      removeFingerprintOnSuccess: true,
      onProgress: (sent, total) => options.onProgress?.({ sent, total }),
      onSuccess: () => resolve(),
      onError: (error) => reject(error),
    });

    // Aborting has to terminate the session, not just stop reading: a half-done
    // upload otherwise sits on Supabase until its 24-hour expiry.
    options.signal?.addEventListener("abort", () => {
      void upload.abort(true);
      reject(new Error("Upload cancelled"));
    });

    upload.start();
  });
}
