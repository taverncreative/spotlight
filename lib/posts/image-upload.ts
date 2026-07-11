import { createClient } from "@/lib/supabase/client";

export type UploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_BYTES = 5 * 1024 * 1024;
const BUCKET = "post-images";

// Uploads a blog image straight from the browser to post-images/{client_id}/
// <uuid>.<ext> and returns its public URL. Storage RLS (owns_client on the
// client-id folder) is the write gate; the server only ever sees the URL, at
// save time. Never throws: every failure returns { ok: false, error }.
export async function uploadPostImage(
  file: File,
  clientId: string
): Promise<UploadResult> {
  if (!clientId) return { ok: false, error: "Missing client." };
  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      ok: false,
      error: `${file.name}: unsupported image type (use PNG, JPEG, WebP or GIF).`,
    };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `${file.name}: image must be under 5 MB.` };
  }

  const ext = (file.name.split(".").pop() ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const path = `${clientId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;

  const supabase = createClient();
  try {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) return { ok: false, error: `${file.name}: upload failed.` };
  } catch {
    return { ok: false, error: `${file.name}: upload failed.` };
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
