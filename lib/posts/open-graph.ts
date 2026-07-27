// Open Graph tags for a post, DERIVED from fields that already exist.
//
// A PURE function. No new storage, no image rendering, no network. Every value
// comes from a column the post already has, so there is nothing to keep in sync
// and nothing to go stale.
//
// OMITTED RATHER THAN GUESSED, throughout. A tag that is absent lets the crawler
// fall back to something sensible; a tag that is present and wrong is asserted
// as fact and shared that way. Every optional field here is left out when its
// source is empty rather than emitted blank.

export type OpenGraphSource = {
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  excerpt: string | null;
  featuredImage: string | null;
  featuredImageAlt: string | null;
  slug: string;
  blogBaseUrl: string | null;
};

export type OpenGraph = {
  "og:type": "article";
  "og:title": string;
  "og:description"?: string;
  "og:image"?: string;
  "og:image:alt"?: string;
  "og:url"?: string;
};

// Join a base to a slug without caring whether the base has a trailing slash.
// 0038 says blog_base_url is stored without one, but "stored without one" is a
// convention rather than a constraint, and a double slash in a shared URL is the
// kind of thing nobody notices until a crawler treats it as a different page.
function postUrl(blogBaseUrl: string, slug: string): string | null {
  const base = blogBaseUrl.trim().replace(/\/+$/, "");
  if (!base) return null;
  // Must be absolute: a relative og:url is meaningless to a crawler, which has
  // no page context to resolve it against.
  if (!/^https?:\/\//i.test(base)) return null;
  return `${base}/${slug}`;
}

export function openGraph(source: OpenGraphSource): OpenGraph {
  const og: OpenGraph = {
    "og:type": "article",
    // The SOCIAL CARD headline, so meta_title wins where it is set.
    //
    // This deliberately differs from the Article schema's headline, which uses
    // the plain title. The two are not the same job: meta_title is written for a
    // search result and often carries a brand suffix, which reads correctly on a
    // shared card and incorrectly as the document's headline.
    "og:title": source.metaTitle?.trim() || source.title,
  };

  const description =
    source.metaDescription?.trim() || source.excerpt?.trim() || "";
  if (description) og["og:description"] = description;

  // Every stored featured image is an absolute Supabase storage URL, so there is
  // no base to apply. A relative one would need the client's own site to resolve
  // it, which is exactly what we do not know, so it is dropped rather than
  // shared as a broken image.
  const image = source.featuredImage?.trim() ?? "";
  if (image && /^https?:\/\//i.test(image)) {
    og["og:image"] = image;
    const alt = source.featuredImageAlt?.trim();
    if (alt) og["og:image:alt"] = alt;
  }

  // og:url is OMITTED when blog_base_url is unknown, which today is every
  // client. Deriving it from sites.url would mean guessing whether posts live at
  // /slug or /blog/slug, and a wrong og:url sends every share of every post to a
  // page that may not exist. Absent, a crawler canonicalises to the URL it
  // actually fetched, which is right by default -- so the cost of omitting it is
  // losing canonicalisation across query strings, and the cost of guessing it is
  // breaking every share.
  if (source.blogBaseUrl) {
    const url = postUrl(source.blogBaseUrl, source.slug);
    if (url) og["og:url"] = url;
  }

  return og;
}
