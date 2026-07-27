// Structured data: what a post stores, and the Article that is derived rather
// than stored.
//
// A PURE module. No database, no clock, no React, so the JSON-LD a post emits is
// a function of the post and nothing else, and can be tested the way
// lib/posts/seo-score.ts is.

// --- what is stored -------------------------------------------------------

// One entry in posts.schemas (migration 0070). Kept to {type, data} so a new
// type is an editor change rather than a migration, and so the API can iterate
// entries without knowing what any of them mean.
export type PostSchema = {
  type: string;
  data: Record<string, unknown>;
};

// The only operator-authored type today.
//
// HONESTY ABOUT WHAT THIS IS FOR. Google restricted FAQ rich results to
// recognised health and government sites in 2023. For a salon or a services
// company this markup will NOT produce the expandable questions in search
// results, and anyone told otherwise has been sold something. It is still worth
// having as structure -- it describes the page accurately for anything that
// reads the page as data rather than as prose -- but that is the claim, and the
// editor copy says exactly this rather than implying traffic.
export const FAQ_TYPE = "FAQPage";

export type FaqEntry = { question: string; answer: string };

export function faqEntries(schemas: PostSchema[]): FaqEntry[] {
  const faq = schemas.find((entry) => entry.type === FAQ_TYPE);
  const raw = faq?.data?.questions;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      question: String((item as FaqEntry)?.question ?? "").trim(),
      answer: String((item as FaqEntry)?.answer ?? "").trim(),
    }))
    .filter((entry) => entry.question.length > 0 && entry.answer.length > 0);
}

// --- what is derived ------------------------------------------------------

// The fields the Article is composed from. Deliberately the shape the content
// API function returns, so the route can hand its row straight over.
export type ArticleSource = {
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  excerpt: string | null;
  featuredImage: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  clientName: string | null;
};

// Article, composed from the post's own fields at READ time.
//
// Not stored, because a stored copy goes stale: publishPost and unpublishPost
// change status and published_at without going near the editor, so a materialised
// datePublished would be wrong the moment a post is published from the list.
//
// OMITTED RATHER THAN GUESSED. Every optional field is left out when its source
// is empty, instead of being emitted as null or an empty string: absent means
// "we do not claim this", whereas an empty headline is a claim, and a wrong one.
// Same reason mainEntityOfPage is not here at all -- it needs the post's public
// URL, and blog_base_url is unset on every client, so the client's own template
// is the only thing that honestly knows it.
export function articleSchema(source: ArticleSource): PostSchema {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    // The real headline is what the page shows, not the search-result override:
    // meta_title is written for the SERP, and Article should describe the page.
    headline: source.title,
  };

  const description =
    source.metaDescription?.trim() || source.excerpt?.trim() || "";
  if (description) data.description = description;

  if (source.featuredImage) data.image = [source.featuredImage];
  if (source.publishedAt) data.datePublished = source.publishedAt;
  if (source.updatedAt) data.dateModified = source.updatedAt;

  if (source.clientName?.trim()) {
    // The client is the publisher of their own blog. Organization rather than
    // Person: these are business sites, and there is no per-post author in the
    // data to claim otherwise.
    data.author = { "@type": "Organization", name: source.clientName.trim() };
    data.publisher = { "@type": "Organization", name: source.clientName.trim() };
  }

  return { type: "Article", data };
}

// What the content API serves: the derived Article first, then whatever the
// operator authored. Article leads because it describes the page itself and the
// rest qualify it.
export function composeSchemas(
  source: ArticleSource,
  stored: PostSchema[]
): Record<string, unknown>[] {
  return [articleSchema(source), ...stored].map((entry) => entry.data);
}

// Parse whatever came back from jsonb into entries we are willing to serve.
// The column has a shape constraint (0070), but this is the boundary between the
// database and a client's live site, and a malformed entry here breaks their
// page rather than ours.
export function parseSchemas(value: unknown): PostSchema[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const type = (entry as PostSchema).type;
    if (typeof type !== "string" || !type) return [];
    const data = (entry as PostSchema).data;
    if (!data || typeof data !== "object") return [];
    return [{ type, data: data as Record<string, unknown> }];
  });
}

// Build the stored array from the editor's FAQ rows. Blank rows are dropped, and
// an empty list stores nothing at all rather than an FAQPage with no questions,
// which would be a claim about the page that is not true.
export function schemasFromForm(entries: FaqEntry[]): PostSchema[] {
  const questions = entries
    .map((entry) => ({
      question: entry.question.trim(),
      answer: entry.answer.trim(),
    }))
    .filter((entry) => entry.question && entry.answer);
  if (questions.length === 0) return [];
  return [
    {
      type: FAQ_TYPE,
      data: {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: questions.map((entry) => ({
          "@type": "Question",
          name: entry.question,
          acceptedAnswer: { "@type": "Answer", text: entry.answer },
        })),
        // Kept alongside the schema.org shape so the editor can round-trip the
        // rows without reverse-engineering mainEntity on the way back in.
        questions,
      },
    },
  ];
}
