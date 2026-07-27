import { test } from "node:test";
import assert from "node:assert/strict";
import { openGraph, type OpenGraphSource } from "@/lib/posts/open-graph";

const IMAGE =
  "https://xoxvwyzvsbvbcugzsecb.supabase.co/storage/v1/object/public/post-images/a.jpg";

function source(overrides: Partial<OpenGraphSource> = {}): OpenGraphSource {
  return {
    title: "How to make your balayage last longer",
    metaTitle: "Balayage aftercare | Therapy Hair",
    metaDescription: "Practical ways to make your balayage last longer.",
    excerpt: "A shorter summary.",
    featuredImage: IMAGE,
    featuredImageAlt: "A balayage colour result",
    slug: "balayage-aftercare",
    blogBaseUrl: null,
    ...overrides,
  };
}

test("the full set, for a client that has a blog base", () => {
  const og = openGraph(source({ blogBaseUrl: "https://therapyhair.co.uk/blog" }));
  assert.deepEqual(og, {
    "og:type": "article",
    "og:title": "Balayage aftercare | Therapy Hair",
    "og:description": "Practical ways to make your balayage last longer.",
    "og:image": IMAGE,
    "og:image:alt": "A balayage colour result",
    "og:url": "https://therapyhair.co.uk/blog/balayage-aftercare",
  });
});

test("og:type is always article", () => {
  assert.equal(openGraph(source())["og:type"], "article");
});

// --- title ----------------------------------------------------------------

test("og:title prefers the meta title, unlike the Article headline", () => {
  // Different jobs: meta_title is written for a search result and carries a
  // brand suffix that reads right on a card and wrong as a document headline.
  assert.equal(openGraph(source())["og:title"], "Balayage aftercare | Therapy Hair");
});

test("og:title falls back to the title, and is never empty", () => {
  assert.equal(
    openGraph(source({ metaTitle: null }))["og:title"],
    "How to make your balayage last longer"
  );
  assert.equal(
    openGraph(source({ metaTitle: "   " }))["og:title"],
    "How to make your balayage last longer"
  );
});

// --- description ----------------------------------------------------------

test("og:description falls back to the excerpt, then disappears", () => {
  assert.equal(
    openGraph(source({ metaDescription: null }))["og:description"],
    "A shorter summary."
  );
  const bare = openGraph(source({ metaDescription: null, excerpt: null }));
  assert.ok(!("og:description" in bare), "should omit rather than emit empty");
});

// --- image ----------------------------------------------------------------

test("no featured image means no image tags at all", () => {
  const og = openGraph(source({ featuredImage: null, featuredImageAlt: null }));
  assert.ok(!("og:image" in og));
  assert.ok(!("og:image:alt" in og));
});

test("a RELATIVE image is dropped, not shared as a broken link", () => {
  // Nothing here knows the client's site, so a relative path cannot be resolved.
  const og = openGraph(source({ featuredImage: "/uploads/hero.jpg" }));
  assert.ok(!("og:image" in og));
  assert.ok(!("og:image:alt" in og), "alt without an image is meaningless");
});

test("alt is omitted when blank, but the image still goes out", () => {
  const og = openGraph(source({ featuredImageAlt: "  " }));
  assert.equal(og["og:image"], IMAGE);
  assert.ok(!("og:image:alt" in og));
});

// --- url ------------------------------------------------------------------

test("og:url is OMITTED when blog_base_url is unknown", () => {
  // True for all ten clients today. Absent beats guessed: a crawler falls back
  // to the URL it fetched, which is right by default.
  assert.ok(!("og:url" in openGraph(source({ blogBaseUrl: null }))));
  assert.ok(!("og:url" in openGraph(source({ blogBaseUrl: "   " }))));
});

test("a trailing slash on the base never produces a double slash", () => {
  assert.equal(
    openGraph(source({ blogBaseUrl: "https://therapyhair.co.uk/blog/" }))["og:url"],
    "https://therapyhair.co.uk/blog/balayage-aftercare"
  );
  assert.equal(
    openGraph(source({ blogBaseUrl: "https://therapyhair.co.uk/blog///" }))["og:url"],
    "https://therapyhair.co.uk/blog/balayage-aftercare"
  );
});

test("a NON-absolute blog base is refused: a relative og:url means nothing", () => {
  assert.ok(!("og:url" in openGraph(source({ blogBaseUrl: "therapyhair.co.uk" }))));
  assert.ok(!("og:url" in openGraph(source({ blogBaseUrl: "/blog" }))));
});

test("http is accepted as well as https", () => {
  assert.equal(
    openGraph(source({ blogBaseUrl: "http://example.co.uk" }))["og:url"],
    "http://example.co.uk/balayage-aftercare"
  );
});

// --- the shape as a whole -------------------------------------------------

test("a post with almost nothing still yields a valid card", () => {
  const og = openGraph({
    title: "Untitled",
    metaTitle: null,
    metaDescription: null,
    excerpt: null,
    featuredImage: null,
    featuredImageAlt: null,
    slug: "untitled",
    blogBaseUrl: null,
  });
  // Type and title are the two that are always safe to assert.
  assert.deepEqual(og, { "og:type": "article", "og:title": "Untitled" });
});

test("no key is ever present with an empty or null value", () => {
  const og = openGraph(
    source({ metaDescription: "", excerpt: "", featuredImage: "" })
  ) as Record<string, unknown>;
  for (const [key, value] of Object.entries(og)) {
    assert.ok(
      typeof value === "string" && value.length > 0,
      `${key} came out as ${JSON.stringify(value)}`
    );
  }
});
