import type { SupabaseClient } from "@supabase/supabase-js";
import { SOCIAL_MEDIA_BUCKET } from "@/lib/social/schemas";

// Pure helpers for the social-media bucket. Kept out of the "use server" files so
// the URL helper can be used from both server (card grid) and client (uploader
// preview), and the reaper stays a plain best-effort delete by object path.

// Public URL for a stored object path (the bucket is public-read). Derived from
// the env URL so it works on both server and client.
export function socialMediaPublicUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/${SOCIAL_MEDIA_BUCKET}/${storagePath}`;
}

// Best-effort delete of social-media objects by path. Never throws: a storage
// failure must not block or roll back the primary action. The operator session
// scopes the delete via the social_media_operator_delete policy.
export async function reapSocialMedia(
  supabase: SupabaseClient,
  paths: (string | null | undefined)[]
): Promise<void> {
  const clean = paths.filter((p): p is string => typeof p === "string" && p.length > 0);
  if (clean.length === 0) return;
  try {
    await supabase.storage.from(SOCIAL_MEDIA_BUCKET).remove(clean);
  } catch {
    // best-effort
  }
}
