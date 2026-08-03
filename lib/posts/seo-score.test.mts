import { test } from "node:test";
import assert from "node:assert/strict";
import { seoScore, type SeoInput } from "@/lib/posts/seo-score";

const KEYWORD = "balayage";

// A post that passes everything scoreable, so each test breaks exactly one thing
// and the failure points at one check rather than a whole shape.
function perfect(overrides: Partial<SeoInput> = {}): SeoInput {
  return {
    focusKeyword: KEYWORD,
    title: "How to make your balayage last longer",
    metaTitle: null,
    slug: "how-to-make-your-balayage-last",
    metaDescription:
      "Practical ways to make your balayage last longer between salon visits.",
    body: [
      "Your balayage looks its best in the first few weeks, and there is plenty you can do to keep it that way. Book in at [our salon](https://therapyhair.co.uk/book) when you need a toner.",
      "## Washing your balayage",
      "Wash less often and use cooler water. The [Fanola guide](https://fanola.com/toning) explains why.",
      "### Choosing a shampoo",
      "Sulphate-free keeps the tone true for longer, which is what most people notice first.",
      "![A balayage colour result](/img/a.jpg)",
    ].join("\n\n"),
    featuredImage: "/img/hero.jpg",
    featuredImageAlt: "A balayage colour result",
    siteUrls: ["https://therapyhair.co.uk"],
    blogBaseUrl: null,
    schemas: [],
    ageDays: null,
    ...overrides,
  };
}

const byId = (input: SeoInput, id: string) => {
  const check = seoScore(input).checks.find((c) => c.id === id);
  assert.ok(check, `no check with id ${id}`);
  return check;
};

const ids = (input: SeoInput) => seoScore(input).checks.map((c) => c.id);

// --- no keyword -----------------------------------------------------------

test("no focus keyword gives null, not zero", () => {
  const result = seoScore(perfect({ focusKeyword: null }));
  assert.equal(result.score, null);
  assert.deepEqual(result.checks, []);
});

// --- the happy path -------------------------------------------------------

test("a post doing everything right scores 1, with pending and notes excluded", () => {
  const result = seoScore(perfect());
  const failed = result.checks
    .filter((c) => c.status === "fail")
    .map((c) => c.id);
  assert.deepEqual(failed, [], `unexpected failures: ${failed.join(", ")}`);
  assert.equal(result.score, 1);
  assert.equal(result.passed, result.total);
  // total counts scoreable checks only, never the judgement prompts.
  assert.ok(result.checks.length > result.total);
});

// --- the removals ---------------------------------------------------------

test("the 300-word check is gone; the floor left is a draft check", () => {
  assert.ok(
    !ids(perfect()).includes("body-length"),
    "body-length still exists"
  );
  const check = byId(perfect(), "has-content");
  assert.match(check.detail ?? "", /draft check, not an SEO one/i);
  assert.match(check.detail ?? "", /not a ranking factor/i);
});

test("a 200-word post passes the content check; length is not scored", () => {
  const body = [
    "Balayage intro paragraph.",
    ...Array.from({ length: 30 }, (_, i) => `Sentence ${i} of ordinary prose.`),
  ].join("\n\n");
  assert.equal(byId(perfect({ body }), "has-content").status, "pass");
});

test("an empty draft is caught, and says it is a draft check", () => {
  const check = byId(perfect({ body: "Balayage." }), "has-content");
  assert.equal(check.status, "fail");
  assert.match(check.detail ?? "", /^1 words/);
});

test("short posts are not judged on density at all", () => {
  // Two mentions in thirty words is 6.7% and means nothing.
  const short = "Balayage is lovely. Ask about balayage when you book in.";
  assert.equal(
    byId(perfect({ body: short }), "keyword-not-stuffed").status,
    "pass"
  );
});

test("density has NO lower bound: one mention in a long post still passes", () => {
  const thin = [
    "One mention of balayage here.",
    ...Array.from({ length: 200 }, (_, i) => `Sentence ${i} with no keyword.`),
  ].join(" ");
  const check = byId(perfect({ body: thin }), "keyword-not-stuffed");
  assert.equal(check.status, "pass");
  // No target range in the wording either.
  assert.doesNotMatch(check.detail ?? "", /range|target|minimum|too few/i);
});

test("density still fails upward, and says it reads as stuffed", () => {
  // Long enough to be judged at all, and genuinely stuffed: 40 mentions in
  // roughly 200 words.
  const stuffed = [
    Array.from({ length: 40 }, () => "balayage").join(" "),
    ...Array.from(
      { length: 30 },
      (_, i) => `Sentence ${i} of ordinary filler.`
    ),
  ].join(" ");
  const check = byId(perfect({ body: stuffed }), "keyword-not-stuffed");
  assert.equal(check.status, "fail");
  assert.match(check.detail ?? "", /reads as stuffed/);
});

// --- the relabels ---------------------------------------------------------

test("meta description checks claim click-through, not ranking", () => {
  const set = byId(perfect(), "meta-description-set");
  assert.match(set.detail ?? "", /click-through/i);
  assert.doesNotMatch(set.label + (set.detail ?? ""), /improves ranking/i);
  assert.match(set.detail ?? "", /rewrites/i);
});

test("meta title length is framed as display hygiene", () => {
  const check = byId(perfect(), "meta-title-length");
  assert.match(check.detail ?? "", /display hygiene/i);
  assert.match(check.detail ?? "", /not a limit or a ranking rule/i);
});

test("keyword in slug is Polish, low priority, and warns off changing a URL", () => {
  const check = byId(perfect(), "keyword-in-slug");
  assert.equal(check.importance, "polish");
  assert.match(check.label, /low priority/i);
  assert.match(check.detail ?? "", /never change a published URL/i);
});

// --- heading hierarchy ----------------------------------------------------

test("an H1 in the body is a fault: the title is already the H1", () => {
  const check = byId(
    perfect({ body: "# Balayage\n\nSome prose about balayage." }),
    "heading-hierarchy"
  );
  assert.equal(check.status, "fail");
  assert.match(check.detail ?? "", /already the H1/i);
});

test("a skipped level is a fault, and the detail names it", () => {
  const check = byId(
    perfect({ body: "Intro balayage.\n\n## Two\n\n#### Four" }),
    "heading-hierarchy"
  );
  assert.equal(check.status, "fail");
  assert.equal(check.detail, "H2 jumps to H4, skipping a level");
});

test("starting at H3 is a fault", () => {
  const check = byId(
    perfect({ body: "Intro balayage.\n\n### Three" }),
    "heading-hierarchy"
  );
  assert.equal(check.status, "fail");
  assert.match(check.detail ?? "", /Starts at H3/);
});

test("no headings is not a hierarchy fault", () => {
  const check = byId(
    perfect({ body: "Just one paragraph about balayage." }),
    "heading-hierarchy"
  );
  assert.equal(check.status, "pass");
  assert.equal(check.detail, "No headings yet");
});

// --- links ----------------------------------------------------------------

test("internal links: matched against the client's own hosts", () => {
  const check = byId(perfect(), "internal-links");
  assert.equal(check.status, "pass");
  assert.equal(check.detail, "1 internal, 1 external");
});

test("relative links count as internal; anchors do not count at all", () => {
  const body =
    "Balayage intro with [a relative link](/services) and [an anchor](#top).";
  assert.equal(
    byId(perfect({ body }), "internal-links").detail,
    "1 internal, 0 external"
  );
});

test("zero internal links fails", () => {
  const body =
    "Balayage intro with only [an outside link](https://example.com).";
  const check = byId(perfect({ body }), "internal-links");
  assert.equal(check.status, "fail");
  assert.equal(check.detail, "0 internal, 1 external");
});

test("a client with no site on record is told so rather than just failing", () => {
  const check = byId(
    perfect({ siteUrls: [], blogBaseUrl: null, body: "Balayage only." }),
    "internal-links"
  );
  assert.equal(check.detail, "No site on record to link to yet");
});

test("blog_base_url counts as an own host when no site is recorded", () => {
  const check = byId(
    perfect({
      siteUrls: [],
      blogBaseUrl: "https://therapyhair.co.uk/news",
      body: "Balayage. [Read more](https://www.therapyhair.co.uk/other).",
    }),
    "internal-links"
  );
  // www. is stripped before comparing, so this is the same host.
  assert.equal(check.status, "pass");
  assert.equal(check.detail, "1 internal, 0 external");
});

test("images are not counted as links", () => {
  const body = "Balayage intro.\n\n![alt](https://cdn.example.com/a.jpg)";
  assert.equal(
    byId(perfect({ body }), "internal-links").detail,
    "0 internal, 0 external"
  );
});

// --- schema ---------------------------------------------------------------

test("Article is a NOTE, never scored: it is emitted automatically", () => {
  // Scoring it would be a row that can never fail, because Article is composed
  // from the post's own fields for every published post.
  const check = byId(perfect(), "schema-article");
  assert.equal(check.status, "note");
  assert.equal(check.importance, "judgement");
});

test("the Article note cannot move the score in either direction", () => {
  assert.equal(seoScore(perfect({ schemas: [] })).score, 1);
  assert.equal(seoScore(perfect({ schemas: [{ type: "FAQPage" }] })).score, 1);
});

test("an FAQ is reported in the note rather than scored", () => {
  const none = byId(perfect({ schemas: [] }), "schema-article");
  assert.match(none.detail ?? "", /title, description, image and dates/i);

  const one = byId(
    perfect({ schemas: [{ type: "FAQPage" }] }),
    "schema-article"
  );
  assert.match(one.detail ?? "", /1 question\b/);
});

test("nothing in the checklist can fail because of structured data", () => {
  const scoreable = seoScore(perfect({ schemas: [] })).checks.filter(
    (c) => c.status === "pass" || c.status === "fail"
  );
  assert.ok(!scoreable.some((c) => /schema/i.test(c.id)));
});

test("Breadcrumb is NOT checked: it is the client template's concern", () => {
  assert.ok(!ids(perfect()).some((id) => /breadcrumb/i.test(id)));
});

// --- judgement prompts ----------------------------------------------------

test("prompts are notes, never pass or fail, and never scored", () => {
  const result = seoScore(perfect());
  const prompts = result.checks.filter((c) => c.importance === "judgement");
  assert.ok(prompts.length >= 5, "expected the coaching prompts");
  for (const prompt of prompts) {
    assert.equal(prompt.status, "note", `${prompt.id} should be a note`);
  }
  // None of them appear in the scoreable total.
  assert.equal(result.total, result.checks.length - prompts.length);
});

test("the intent prompt quotes the actual keyword", () => {
  const check = byId(perfect({ focusKeyword: "biab nails" }), "intent");
  assert.match(check.label, /biab nails/);
});

test("the staleness prompt appears only on an older post", () => {
  assert.ok(!ids(perfect({ ageDays: null })).includes("still-accurate"));
  assert.ok(!ids(perfect({ ageDays: 30 })).includes("still-accurate"));
  const check = byId(perfect({ ageDays: 400 }), "still-accurate");
  assert.equal(check.status, "note");
  assert.match(check.detail ?? "", /13 months ago/);
});

test("unanswered prompts cannot lower the score", () => {
  // Every prompt is unanswered in every case, and the post still scores 1.
  assert.equal(seoScore(perfect()).score, 1);
});

// --- weighting ------------------------------------------------------------

test("an essential failure costs more than a polish failure", () => {
  const essential = seoScore(perfect({ title: "Nothing relevant" })).score;
  const polish = seoScore(perfect({ featuredImageAlt: "" })).score;
  assert.ok(essential !== null && polish !== null);
  assert.ok(
    essential < polish,
    `essential (${essential}) should cost more than polish (${polish})`
  );
});

test("featured image alt is not a second failure when there is no image", () => {
  const noImage = perfect({ featuredImage: null, featuredImageAlt: null });
  assert.equal(byId(noImage, "featured-image").status, "fail");
  assert.equal(byId(noImage, "featured-image-alt").status, "pass");
});

// --- keyword matching -----------------------------------------------------

test("matching is case and smart-quote insensitive", () => {
  const curly = perfect({
    focusKeyword: "stylist's balayage",
    title: "A stylist’s balayage guide",
  });
  assert.equal(byId(curly, "keyword-in-title").status, "pass");
});

// The slug. Separators mean nothing here, so all four spellings are one thing.
for (const slug of [
  "balayage-aftercare",
  "balayage_aftercare",
  "balayageaftercare",
  "the-balayage-aftercare-guide",
]) {
  test(`slug check matches "${slug}" for a spaced keyword`, () => {
    const input = perfect({ focusKeyword: "balayage aftercare", slug });
    assert.equal(byId(input, "keyword-in-slug").status, "pass");
  });
}

test("slug check survives punctuation the slug dropped", () => {
  const input = perfect({
    focusKeyword: "stylist's balayage",
    slug: "stylists-balayage-guide",
  });
  assert.equal(byId(input, "keyword-in-slug").status, "pass");
});

test("a hyphenated keyword matches a spaced slug too", () => {
  const input = perfect({
    focusKeyword: "half-price balayage",
    slug: "half price balayage",
  });
  assert.equal(byId(input, "keyword-in-slug").status, "pass");
});

test("the slug check still fails when the keyword is genuinely absent", () => {
  const input = perfect({ focusKeyword: "balayage", slug: "highlights-guide" });
  assert.equal(byId(input, "keyword-in-slug").status, "fail");
});

// Prose. Word-joining punctuation is noise in BOTH directions.
test("a hyphenated title matches a spaced keyword", () => {
  const input = perfect({
    focusKeyword: "balayage aftercare",
    title: "Balayage-aftercare tips",
  });
  assert.equal(byId(input, "keyword-in-title").status, "pass");
});

test("a hyphenated keyword matches spaced prose", () => {
  const input = perfect({
    focusKeyword: "half-price balayage",
    title: "Half price balayage this month",
  });
  assert.equal(byId(input, "keyword-in-title").status, "pass");
});

test("an en dash joins words the same as a hyphen", () => {
  const input = perfect({
    focusKeyword: "balayage aftercare",
    metaDescription: "Our balayage–aftercare advice.",
  });
  assert.equal(byId(input, "keyword-in-meta-description").status, "pass");
});

test("the opening paragraph and subheadings normalise the same way", () => {
  const input = perfect({
    focusKeyword: "balayage aftercare",
    body: "Your balayage-aftercare routine matters.\n\n## Balayage/aftercare basics\n\nMore prose.",
  });
  assert.equal(byId(input, "keyword-in-first-paragraph").status, "pass");
  assert.equal(byId(input, "keyword-in-subheading").status, "pass");
});

// The deliberate non-fix: sentence punctuation must NOT join words, or the
// checklist starts passing posts where the phrase never appears.
test("a sentence boundary does not fake a keyword match", () => {
  const input = perfect({
    focusKeyword: "balayage aftercare",
    title: "About balayage. Aftercare comes later",
  });
  assert.equal(byId(input, "keyword-in-title").status, "fail");
});

test("an empty body does not throw", () => {
  const result = seoScore(perfect({ body: null }));
  assert.ok(result.score !== null);
  assert.equal(
    byId(perfect({ body: null }), "has-content").detail?.startsWith("0 words"),
    true
  );
});
