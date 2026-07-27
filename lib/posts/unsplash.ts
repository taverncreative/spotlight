// A pre-searched Unsplash link. Not an API integration, and deliberately so.
//
// WHY A LINK AND NOT THE API. The Unsplash API guidelines require that image
// displays "use the URLs provided by the API under the photo.urls properties,
// not local copies or alternative sources". Every featured image here lives in
// the post-images bucket and is served as an absolute Supabase URL, which is
// what og:image, the Article schema and every client template consume. A
// compliant integration would mean client sites hotlinking Unsplash's CDN
// instead -- a third-party availability dependency on live client pages in
// exchange for skipping an upload. That is a different image model, not a better
// version of this one.
//
// The API also makes attribution mandatory, and attribution has to appear where
// the photo displays: on the client sites, in their own repos. The LICENCE, by
// contrast, requires nothing -- "No permission needed (though attribution is
// appreciated!)" -- so downloading and uploading by hand, as now, carries no
// credit obligation at all.
//
// A pure function, so the query rules are testable without a browser.

// Landscape only. A featured image is used as og:image, where the shared card is
// wide (1200x630 is the usual target), and as the post hero, which is also wide.
// Filtering here saves scrolling past portraits that were never candidates.
const ORIENTATION = "landscape";

// Long queries return worse results than short ones: Unsplash matches tags, not
// sentences, so a full post title tends to drop to near-random. Trimmed to the
// first few words when falling back to a title.
const TITLE_WORD_LIMIT = 6;

export function unsplashQuery(
  focusKeyword: string | null,
  title: string | null
): string {
  const keyword = (focusKeyword ?? "").trim();
  // The focus keyword is the better query by a distance: it is already the two
  // or three words the post is about, which is the shape Unsplash search wants.
  if (keyword) return keyword;

  const words = (title ?? "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, TITLE_WORD_LIMIT).join(" ");
}

// null when there is nothing worth searching for, so the caller can disable the
// button rather than open an empty search.
export function unsplashSearchUrl(
  focusKeyword: string | null,
  title: string | null
): string | null {
  const query = unsplashQuery(focusKeyword, title);
  if (!query) return null;
  return `https://unsplash.com/s/photos/${encodeURIComponent(
    query
  )}?orientation=${ORIENTATION}`;
}
