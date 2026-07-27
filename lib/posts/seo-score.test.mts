import { test } from "node:test";
import assert from "node:assert/strict";
import { seoScore, type SeoInput } from "@/lib/posts/seo-score";

const KEYWORD = "balayage";

// A post that passes everything, so each test can break exactly one thing and
// the failure points at one check rather than a whole shape.
function perfect(overrides: Partial<SeoInput> = {}): SeoInput {
  return {
    focusKeyword: KEYWORD,
    title: "How to make your balayage last longer",
    metaTitle: null,
    slug: "how-to-make-your-balayage-last",
    metaDescription:
      "Practical ways to make your balayage last longer between salon visits.",
    body: [
      "Your balayage looks its best in the first few weeks, and there is a lot you can do to keep it that way for months afterwards.",
      "## Washing your balayage",
      // Long enough to clear the 300-word floor, with the keyword recurring
      // often enough to land inside the density band rather than under it.
      ...Array.from({ length: 60 }, (_, i) =>
        i % 12 === 0
          ? `Sentence ${i} about keeping your balayage bright between visits.`
          : `Sentence ${i} about aftercare, toning and everyday colour upkeep.`
      ),
      "![A balayage colour result](/img/a.jpg)",
    ].join("\n\n"),
    featuredImage: "/img/hero.jpg",
    featuredImageAlt: "A balayage colour result",
    ...overrides,
  };
}

const byId = (input: SeoInput, id: string) => {
  const check = seoScore(input).checks.find((c) => c.id === id);
  assert.ok(check, `no check with id ${id}`);
  return check;
};

// --- no keyword: the case every post starts in ----------------------------

test("no focus keyword gives null, not zero", () => {
  const result = seoScore(perfect({ focusKeyword: null }));
  assert.equal(result.score, null);
  assert.deepEqual(result.checks, []);
});

test("a whitespace-only keyword is the same as none", () => {
  assert.equal(seoScore(perfect({ focusKeyword: "   " })).score, null);
});

// --- the happy path -------------------------------------------------------

test("a post doing everything right scores 1", () => {
  const result = seoScore(perfect());
  const failed = result.checks.filter((c) => !c.passed).map((c) => c.id);
  assert.deepEqual(failed, [], `unexpected failures: ${failed.join(", ")}`);
  assert.equal(result.score, 1);
  assert.equal(result.passed, result.total);
});

// --- essential ------------------------------------------------------------

test("keyword must be in the title, which is also the H1", () => {
  const check = byId(perfect({ title: "Making colour last" }), "keyword-in-title");
  assert.equal(check.passed, false);
  // The label has to say it covers the H1, or it reads like a missing check.
  assert.match(check.label, /H1/);
});

test("slug matches a slugified keyword, not a literal one", () => {
  assert.equal(
    byId(
      { ...perfect(), focusKeyword: "BIAB vs Gel", slug: "biab-vs-gel-vs-acrylic" },
      "keyword-in-slug"
    ).passed,
    true
  );
  assert.equal(
    byId(perfect({ slug: "how-to-keep-colour" }), "keyword-in-slug").passed,
    false
  );
});

test("meta description: written and containing the keyword are separate checks", () => {
  const blank = perfect({ metaDescription: "" });
  assert.equal(byId(blank, "meta-description-set").passed, false);
  assert.equal(byId(blank, "keyword-in-meta-description").passed, false);

  // Written, but not about the keyword: one passes, one does not.
  const vague = perfect({ metaDescription: "Some tips from our stylists." });
  assert.equal(byId(vague, "meta-description-set").passed, true);
  assert.equal(byId(vague, "keyword-in-meta-description").passed, false);
});

// --- important ------------------------------------------------------------

test("the opening paragraph skips headings, images and lists", () => {
  const body = [
    "## A heading first",
    "![alt](/i.jpg)",
    "- a list item",
    "The real opening paragraph mentions balayage.",
  ].join("\n\n");
  assert.equal(
    byId(perfect({ body }), "keyword-in-first-paragraph").passed,
    true
  );

  const noMention = [
    "## A heading first",
    "The real opening paragraph says nothing relevant.",
    "But balayage appears later on.",
  ].join("\n\n");
  assert.equal(
    byId(perfect({ body: noMention }), "keyword-in-first-paragraph").passed,
    false
  );
});

test("subheading check reports when there are none at all", () => {
  const check = byId(
    perfect({ body: "Just one paragraph about balayage and nothing else." }),
    "keyword-in-subheading"
  );
  assert.equal(check.passed, false);
  assert.equal(check.detail, "No subheadings yet");
});

test("density fails when the keyword is stuffed", () => {
  const stuffed = Array.from({ length: 40 }, () => "balayage").join(" ");
  const check = byId(perfect({ body: stuffed }), "keyword-density");
  assert.equal(check.passed, false);
  assert.match(check.detail ?? "", /stuffed/);
});

test("density fails when the keyword barely appears", () => {
  const thin = [
    "One mention of balayage here.",
    ...Array.from({ length: 120 }, (_, i) => `Sentence ${i} with no keyword.`),
  ].join(" ");
  const check = byId(perfect({ body: thin }), "keyword-density");
  assert.equal(check.passed, false);
});

// --- polish ---------------------------------------------------------------

test("featured image alt is not a second failure when there is no image", () => {
  // Without this, removing the image would cost two checks for one mistake.
  const noImage = perfect({ featuredImage: null, featuredImageAlt: null });
  assert.equal(byId(noImage, "featured-image").passed, false);
  assert.equal(byId(noImage, "featured-image-alt").passed, true);
});

test("body images: none passes, all-with-alt passes, any-missing fails", () => {
  assert.equal(
    byId(perfect({ body: "No images about balayage here." }), "body-images-alt")
      .passed,
    true
  );

  const missing = perfect({
    body: "Balayage intro.\n\n![](/a.jpg)\n\n![good alt](/b.jpg)",
  });
  const check = byId(missing, "body-images-alt");
  assert.equal(check.passed, false);
  assert.equal(check.detail, "1 of 2");
});

test("meta title length uses the title when no meta title is set", () => {
  const longTitle = "x".repeat(80);
  const check = byId(
    perfect({ title: longTitle, metaTitle: null }),
    "meta-title-length"
  );
  assert.equal(check.passed, false);
  assert.equal(check.detail, "80 characters");

  // An explicit meta title takes over from an over-long headline.
  assert.equal(
    byId(
      perfect({ title: longTitle, metaTitle: "Short balayage title" }),
      "meta-title-length"
    ).passed,
    true
  );
});

test("word count ignores markdown syntax", () => {
  const check = byId(
    perfect({ body: "# Heading\n\n![alt text](/a.jpg)\n\n[link](/x) balayage" }),
    "body-length"
  );
  // Heading(1) + alt text(2) + link(1) + balayage(1); the URLs and punctuation
  // must not be counted as words.
  assert.match(check.detail ?? "", /^\d+ words$/);
  assert.ok(Number((check.detail ?? "").split(" ")[0]) < 10);
});

// --- weighting and matching ----------------------------------------------

test("an essential failure costs more than a polish failure", () => {
  const essentialGone = seoScore(perfect({ title: "Nothing relevant" })).score;
  const polishGone = seoScore(perfect({ featuredImageAlt: "" })).score;
  assert.ok(essentialGone !== null && polishGone !== null);
  assert.ok(
    essentialGone < polishGone,
    `essential (${essentialGone}) should cost more than polish (${polishGone})`
  );
});

test("matching is case and smart-quote insensitive", () => {
  const input = perfect({
    focusKeyword: "Balayage Aftercare",
    title: "The best balayage aftercare routine",
    metaDescription: "Our balayage aftercare advice.",
  });
  assert.equal(byId(input, "keyword-in-title").passed, true);
  assert.equal(byId(input, "keyword-in-meta-description").passed, true);

  const curly = perfect({
    focusKeyword: "stylist's balayage",
    title: "A stylist’s balayage guide",
  });
  assert.equal(byId(curly, "keyword-in-title").passed, true);
});

test("an empty body does not throw and reports itself", () => {
  const result = seoScore(perfect({ body: null }));
  assert.ok(result.score !== null);
  assert.equal(byId(perfect({ body: null }), "keyword-density").detail, "No body yet");
  assert.equal(byId(perfect({ body: null }), "body-length").detail, "0 words");
});
