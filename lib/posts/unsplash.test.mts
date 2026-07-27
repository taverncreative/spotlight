import { test } from "node:test";
import assert from "node:assert/strict";
import { unsplashQuery, unsplashSearchUrl } from "@/lib/posts/unsplash";

// --- which field wins -----------------------------------------------------

test("the focus keyword is the query when it is set", () => {
  assert.equal(
    unsplashQuery("balayage aftercare", "How to make your balayage last longer"),
    "balayage aftercare"
  );
});

test("the title is the fallback, trimmed to something searchable", () => {
  // Unsplash matches tags, not sentences, so a whole title searches badly.
  assert.equal(
    unsplashQuery(null, "How to make your balayage last longer this summer"),
    "How to make your balayage last"
  );
});

test("a short title is used whole", () => {
  assert.equal(unsplashQuery(null, "Balayage aftercare"), "Balayage aftercare");
});

test("a whitespace-only keyword falls through to the title", () => {
  assert.equal(unsplashQuery("   ", "Balayage aftercare"), "Balayage aftercare");
});

test("messy whitespace in a title collapses", () => {
  assert.equal(unsplashQuery(null, "  Balayage\n\n aftercare  "), "Balayage aftercare");
});

// --- the URL --------------------------------------------------------------

test("the search URL is landscape-filtered", () => {
  // A featured image becomes og:image and the post hero, both wide.
  assert.equal(
    unsplashSearchUrl("balayage aftercare", null),
    "https://unsplash.com/s/photos/balayage%20aftercare?orientation=landscape"
  );
});

test("punctuation survives a round trip instead of breaking the URL", () => {
  // The assertion that matters is not "no punctuation appears" -- an apostrophe
  // is legal in a path and encodeURIComponent leaves it alone. It is that the
  // query comes back out intact and does not leak into the query string, which
  // a raw & would do.
  const query = "stylist's balayage & tint";
  const url = new URL(unsplashSearchUrl(query, null)!);
  assert.equal(
    decodeURIComponent(url.pathname.replace("/s/photos/", "")),
    query
  );
  assert.equal(url.searchParams.get("orientation"), "landscape");
  // & became %26 rather than starting a second parameter.
  assert.deepEqual([...url.searchParams.keys()], ["orientation"]);
});

test("it always points at unsplash.com over https", () => {
  const url = new URL(unsplashSearchUrl("balayage", null)!);
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "unsplash.com");
});

// --- nothing to search for ------------------------------------------------

test("no keyword and no title gives null, so the button can be disabled", () => {
  assert.equal(unsplashSearchUrl(null, null), null);
  assert.equal(unsplashSearchUrl("", ""), null);
  assert.equal(unsplashSearchUrl("  ", "  "), null);
});
