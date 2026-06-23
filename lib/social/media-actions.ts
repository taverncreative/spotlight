"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import {
  SOCIAL_MEDIA_BUCKET,
  ALLOWED_MEDIA_TYPES,
  MAX_MEDIA_BYTES,
} from "@/lib/social/schemas";

export type MediaUploadResult =
  | { ok: true; storage_path: string }
  | { ok: false; error: string };

// Uploads one carousel image to social-media/{client_id}/{post_id}/<uuid>.<ext>
// and returns the object path (stored on the media row; the public URL is derived
// for display). Storage RLS (owns_client on the {client_id} folder) ensures the
// operator can only write under clients they own.
export async function uploadSocialMedia(
  formData: FormData
): Promise<MediaUploadResult> {
  const file = formData.get("file");
  const clientId = String(formData.get("client_id") ?? "");
  const postId = String(formData.get("post_id") ?? "");
  if (!(file instanceof File) || !clientId || !postId) {
    return { ok: false, error: "Missing file, client or post." };
  }
  if (!ALLOWED_MEDIA_TYPES.includes(file.type)) {
    return { ok: false, error: "Unsupported image type (use PNG, JPEG, WebP or GIF)." };
  }
  if (file.size > MAX_MEDIA_BYTES) {
    return { ok: false, error: "Image must be under 10 MB." };
  }

  const ext = (file.name.split(".").pop() ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const path = `${clientId}/${postId}/${randomUUID()}${ext ? `.${ext}` : ""}`;

  const supabase = await createClient();
  const { error } = await supabase.storage
    .from(SOCIAL_MEDIA_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    return { ok: false, error: "Upload failed." };
  }

  return { ok: true, storage_path: path };
}
