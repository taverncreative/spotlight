import { createClient } from "@/lib/supabase/client";

export type UploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

// KEEP IN SYNC with migration 0064, which sets the same two limits on the
// bucket. Both exist on purpose: the bucket is the fence nothing can forget, and
// these are what can name the problem back to the operator before a byte moves.
//
// 2 MB rather than post-images' 5 MB, and no SVG. A logo renders at 44px on the
// card, so anything near a megabyte is a photograph mistaken for a logo; and an
// SVG is a document that can carry script, served here from the app's own
// origin out of a public bucket.
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;
const BUCKET = "client-logos";

// Uploads a client logo straight from the browser to
// client-logos/{client_id}/<uuid>.<ext> and returns its public URL. Storage RLS
// (owns_client on the client-id folder, 0065) is the write gate; the server only
// ever sees the URL, at save time. Never throws: every failure returns
// { ok: false, error }, matching lib/posts/image-upload.ts.
export async function uploadClientLogo(
  file: File,
  clientId: string
): Promise<UploadResult> {
  if (!clientId) return { ok: false, error: "Save the client first." };
  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      ok: false,
      error: "Use a PNG, JPEG or WebP. SVG is not accepted.",
    };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "The logo must be under 2 MB." };
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
    if (error) return { ok: false, error: "Upload failed. Try again." };
  } catch {
    return { ok: false, error: "Upload failed. Try again." };
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
