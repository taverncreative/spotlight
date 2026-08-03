import { test } from "node:test";
import assert from "node:assert/strict";
import {
  articleSchema,
  composeSchemas,
  faqEntries,
  parseSchemas,
  schemasFromForm,
  type ArticleSource,
} from "@/lib/posts/structured-data";

function source(overrides: Partial<ArticleSource> = {}): ArticleSource {
  return {
    title: "How to make your balayage last longer",
    metaTitle: "Balayage aftercare | Therapy Hair",
    metaDescription: "Practical ways to make your balayage last longer.",
    excerpt: "A shorter summary.",
    featuredImage: "https://cdn.example.com/hero.jpg",
    publishedAt: "2026-01-05T09:00:00.000Z",
    updatedAt: "2026-02-01T11:30:00.000Z",
    clientName: "Therapy Hair",
    ...overrides,
  };
}

// --- Article --------------------------------------------------------------

test("Article carries the fields it has", () => {
  const { type, data } = articleSchema(source());
  assert.equal(type, "Article");
  assert.equal(data["@context"], "https://schema.org");
  assert.equal(data["@type"], "Article");
  assert.equal(
    data.description,
    "Practical ways to make your balayage last longer."
  );
  assert.deepEqual(data.image, ["https://cdn.example.com/hero.jpg"]);
  assert.equal(data.datePublished, "2026-01-05T09:00:00.000Z");
  assert.equal(data.dateModified, "2026-02-01T11:30:00.000Z");
  assert.deepEqual(data.author, {
    "@type": "Organization",
    name: "Therapy Hair",
  });
});

test("headline is the real title, not the search-result override", () => {
  // meta_title is written for the SERP. Article describes the page.
  const { data } = articleSchema(source());
  assert.equal(data.headline, "How to make your balayage last longer");
});

test("description falls back to the excerpt, then disappears", () => {
  assert.equal(
    articleSchema(source({ metaDescription: null })).data.description,
    "A shorter summary."
  );
  const bare = articleSchema(
    source({ metaDescription: null, excerpt: null })
  ).data;
  assert.ok(!("description" in bare), "should omit rather than emit empty");
});

test("missing fields are OMITTED, never emitted as null or empty", () => {
  const { data } = articleSchema(
    source({
      metaDescription: null,
      excerpt: null,
      featuredImage: null,
      publishedAt: null,
      updatedAt: null,
      clientName: null,
    })
  );
  // An absent field claims nothing; an empty one claims something false.
  for (const key of [
    "description",
    "image",
    "datePublished",
    "dateModified",
    "author",
    "publisher",
  ]) {
    assert.ok(
      !(key in data),
      `${key} should be absent, got ${String(data[key])}`
    );
  }
  // The one thing always present.
  assert.equal(data.headline, "How to make your balayage last longer");
});

test("a whitespace-only client name is not an author", () => {
  const { data } = articleSchema(source({ clientName: "   " }));
  assert.ok(!("author" in data));
});

test("mainEntityOfPage is never claimed: only the client's site knows its URL", () => {
  assert.ok(!("mainEntityOfPage" in articleSchema(source()).data));
});

// --- composition ----------------------------------------------------------

test("Article leads, stored entries follow, and only data is served", () => {
  const stored = [
    { type: "FAQPage", data: { "@type": "FAQPage", mainEntity: [] } },
  ];
  const composed = composeSchemas(source(), stored);
  assert.equal(composed.length, 2);
  assert.equal(composed[0]["@type"], "Article");
  assert.equal(composed[1]["@type"], "FAQPage");
  // The {type, data} wrapper is internal; a client site emits the data.
  assert.ok(!("type" in composed[0]));
});

test("a post with nothing stored still serves an Article", () => {
  const composed = composeSchemas(source(), []);
  assert.equal(composed.length, 1);
  assert.equal(composed[0]["@type"], "Article");
});

// --- parsing --------------------------------------------------------------

test("malformed stored entries are dropped, not served to a client site", () => {
  const parsed = parseSchemas([
    { type: "FAQPage", data: { a: 1 } },
    { type: "", data: {} },
    { type: "NoData" },
    { data: { orphan: true } },
    "a string",
    null,
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].type, "FAQPage");
});

test("a non-array (or null column) parses to nothing", () => {
  assert.deepEqual(parseSchemas(null), []);
  assert.deepEqual(parseSchemas({ type: "Article" }), []);
  assert.deepEqual(parseSchemas(undefined), []);
});

// --- the FAQ round trip ---------------------------------------------------

test("FAQ rows become an FAQPage in schema.org shape", () => {
  const built = schemasFromForm([
    {
      question: "How long does balayage last?",
      answer: "Three to four months.",
    },
  ]);
  assert.equal(built.length, 1);
  assert.equal(built[0].type, "FAQPage");
  assert.deepEqual(built[0].data.mainEntity, [
    {
      "@type": "Question",
      name: "How long does balayage last?",
      acceptedAnswer: { "@type": "Answer", text: "Three to four months." },
    },
  ]);
});

test("rows round-trip back into the editor", () => {
  const rows = [
    { question: "How long?", answer: "Months." },
    { question: "Cost?", answer: "From 90." },
  ];
  assert.deepEqual(faqEntries(schemasFromForm(rows)), rows);
});

test("a half-filled row is dropped rather than stored", () => {
  const built = schemasFromForm([
    { question: "How long?", answer: "Months." },
    { question: "No answer yet", answer: "   " },
    { question: "", answer: "Orphaned answer." },
  ]);
  assert.equal(faqEntries(built).length, 1);
});

test("no usable rows stores NOTHING, not an empty FAQPage", () => {
  // An FAQPage with no questions is a claim about the page that is not true.
  assert.deepEqual(schemasFromForm([]), []);
  assert.deepEqual(schemasFromForm([{ question: "", answer: "" }]), []);
});

test("reading FAQ entries from an unrelated schema list gives nothing", () => {
  assert.deepEqual(faqEntries([{ type: "Article", data: {} }]), []);
  assert.deepEqual(faqEntries([]), []);
});
