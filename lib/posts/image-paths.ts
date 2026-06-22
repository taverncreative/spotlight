import type { SupabaseClient } from "@supabase/supabase-js";

// Helpers for reaping orphaned post images. Pure path/URL parsing plus a
// best-effort delete. Kept out of the "use server" actions file so the parsers
// can be plain (non-async) and unit-testable.

const BUCKET = "post-images";
const PUBLIC_MARKER = `/storage/v1/object/public/${BUCKET}/`;

// The object path within the post-images bucket for a stored public URL, or null
// when the URL is not under this bucket (external or legacy), so we only ever
// delete our own objects.
export function postImagePath(url: string | null | undefined): string | null {
  if (!url) return null;
  const index = url.indexOf(PUBLIC_MARKER);
  if (index === -1) return null;
  return decodeURIComponent(url.slice(index + PUBLIC_MARKER.length));
}

// Image URLs referenced in a Markdown body via ![alt](url) syntax.
export function inlineImageUrls(body: string | null | undefined): string[] {
  if (!body) return [];
  const urls: string[] = [];
  const pattern = /!\[[^\]]*\]\(\s*([^)\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

// Best-effort delete of post-images objects for the given URLs (external/unknown
// URLs are ignored). Never throws: a storage failure must not block or roll back
// the primary action. The caller's operator session scopes the delete via the
// post_images_operator_delete policy.
export async function reapPostImages(
  supabase: SupabaseClient,
  urls: (string | null | undefined)[]
): Promise<void> {
  const paths = urls
    .map(postImagePath)
    .filter((path): path is string => path !== null);
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(BUCKET).remove(paths);
  } catch {
    // best-effort
  }
}
