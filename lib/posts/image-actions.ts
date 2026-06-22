"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

export type UploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_BYTES = 5 * 1024 * 1024;

// Uploads a blog image to post-images/{client_id}/<uuid>.<ext> and returns its
// public URL. Storage RLS (owns_client on the client-id folder) ensures the
// operator can only write under clients they own. Used for both the featured
// image and inline editor images.
export async function uploadPostImage(formData: FormData): Promise<UploadResult> {
  const file = formData.get("file");
  const clientId = String(formData.get("client_id") ?? "");
  if (!(file instanceof File) || !clientId) {
    return { ok: false, error: "Missing file or client." };
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, error: "Unsupported image type (use PNG, JPEG, WebP or GIF)." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Image must be under 5 MB." };
  }

  const ext = (file.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${clientId}/${randomUUID()}${ext ? `.${ext}` : ""}`;

  const supabase = await createClient();
  const { error } = await supabase.storage
    .from("post-images")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    return { ok: false, error: "Upload failed." };
  }

  const { data } = supabase.storage.from("post-images").getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
