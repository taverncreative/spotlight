// Where a render lives in the bucket.
//
// Pure, and separate from render-to-storage.ts, which is server-only because it
// rasterises. These rules decide what the storage policy will accept and what
// the editor treats as a source photo, so they are worth testing directly.

// Where a render lives.
//
// The first path segment MUST be the client id: the storage policies
// (0028) authorise writes with owns_client on foldername[1], so any other
// shape is rejected rather than merely untidy.
//
// The `renders/` segment is what separates a generated image from a source
// photo in the same bucket. It is not decoration -- the editor's photo picker
// uses it to avoid ever offering a previous render as the source for a new one,
// which would composite words onto words.
//
// TIMESTAMPED, NOT DETERMINISTIC. A stable path plus an overwrite would be
// tidier and wrong: the bucket is public and CDN-backed, so the old bytes keep
// being served under the same URL. A new path per render is what makes a
// re-render actually visible, and the previous object is reaped by the caller.
export function renderPath(
  clientId: string,
  postId: string,
  recipeId: string,
  now: number
): string {
  return `${clientId}/${postId}/renders/${recipeId}-${now}.png`;
}

export function isRenderPath(storagePath: string): boolean {
  return storagePath.includes("/renders/");
}
