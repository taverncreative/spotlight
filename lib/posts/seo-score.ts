// The SEO checklist: a post scored against its focus keyword.
//
// A PURE function over already-gathered strings. No database, no clock, no
// React, so the same post always scores the same and the whole thing is testable
// without a browser, like lib/clients/health.ts.
//
// H1 IS THE TITLE HERE. Checked against real data before writing this: no post
// body in the system contains an `# ` heading, because the client sites render
// the post title as the H1 and the body starts at `##`. A separate "keyword in
// H1" check would therefore have been the title check under another name,
// always agreeing with it and quietly inflating the score. In its place is a
// first-paragraph check, which is the one that actually varies.

export type Importance = "essential" | "important" | "polish";

export type SeoCheck = {
  id: string;
  importance: Importance;
  label: string;
  passed: boolean;
  // Shown when it fails, and sometimes when it passes: a count is more use than
  // a tick when the answer is "how many".
  detail?: string;
};

export type SeoScoreResult = {
  // 0 to 1, or null when there is no focus keyword. Null is not zero: with
  // nothing to score against, an unscored post has not failed anything.
  score: number | null;
  checks: SeoCheck[];
  passed: number;
  total: number;
};

export type SeoInput = {
  focusKeyword: string | null;
  title: string;
  // Null falls back to the title, matching how the editor and the content API
  // treat it.
  metaTitle: string | null;
  slug: string;
  metaDescription: string | null;
  body: string | null;
  featuredImage: string | null;
  featuredImageAlt: string | null;
};

// Weights by importance. Essential checks are the ones that make a post findable
// at all; polish is what separates a good post from a complete one. Relative,
// not percentages: the divisor is the total weight of every check.
const WEIGHTS: Record<Importance, number> = {
  essential: 3,
  important: 2,
  polish: 1,
};

// Density outside this band scores badly in both directions. Too low and the
// page is not obviously about anything; too high and it reads as stuffed, which
// search engines have penalised for two decades and readers notice sooner.
const DENSITY_MIN = 0.005; // 0.5%
const DENSITY_MAX = 0.03; // 3%
const MIN_WORDS = 300;
const META_TITLE_LIMIT = 60;

// --- text helpers ---------------------------------------------------------

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function contains(haystack: string | null, keyword: string): boolean {
  if (!haystack) return false;
  return normalise(haystack).includes(normalise(keyword));
}

// Slugified comparison, so "BIAB vs Gel" matches the slug "biab-vs-gel".
function slugContains(slug: string, keyword: string): boolean {
  const asSlug = normalise(keyword).replace(/[^a-z0-9]+/g, "-");
  return slug.toLowerCase().includes(asSlug);
}

// Markdown stripped back to prose, for counting words and finding the keyword in
// running text rather than in syntax. Deliberately crude: it removes the markup
// that would otherwise be counted as words, and nothing more.
function toProse(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>#-]/g, " ");
}

function wordCount(markdown: string | null): number {
  if (!markdown) return 0;
  const prose = toProse(markdown).trim();
  if (!prose) return 0;
  return prose.split(/\s+/).length;
}

// The first real paragraph: the first non-empty block that is not a heading, an
// image or a list. What a reader actually meets first.
function firstParagraph(markdown: string | null): string {
  if (!markdown) return "";
  for (const block of markdown.split(/\n\s*\n/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (/^#{1,6}\s/.test(trimmed)) continue;
    if (/^!\[/.test(trimmed)) continue;
    if (/^[-*+]\s/.test(trimmed)) continue;
    if (/^>/.test(trimmed)) continue;
    return trimmed;
  }
  return "";
}

function subheadings(markdown: string | null): string[] {
  if (!markdown) return [];
  return (markdown.match(/^#{2,6}\s+.*$/gm) ?? []).map((line) =>
    line.replace(/^#{2,6}\s+/, "")
  );
}

// Markdown images as [altText, ...]. An empty alt is a present-but-empty string,
// which is the case the alt check exists to catch.
function markdownImages(markdown: string | null): string[] {
  if (!markdown) return [];
  return [...(markdown.matchAll(/!\[([^\]]*)\]\([^)]*\)/g) ?? [])].map(
    (match) => match[1] ?? ""
  );
}

function occurrences(haystack: string, keyword: string): number {
  const hay = normalise(haystack);
  const needle = normalise(keyword);
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) break;
    count++;
    from = at + needle.length;
  }
  return count;
}

// --- the checklist --------------------------------------------------------

export function seoScore(input: SeoInput): SeoScoreResult {
  const keyword = (input.focusKeyword ?? "").trim();
  if (!keyword) return { score: null, checks: [], passed: 0, total: 0 };

  const effectiveMetaTitle = input.metaTitle?.trim() || input.title;
  const body = input.body ?? "";
  const words = wordCount(body);
  const prose = toProse(body);
  const hits = occurrences(prose, keyword);
  const density = words > 0 ? hits / words : 0;
  const images = markdownImages(body);
  const imagesWithAlt = images.filter((alt) => alt.trim().length > 0).length;

  const checks: SeoCheck[] = [
    // --- essential --------------------------------------------------------
    {
      id: "keyword-in-title",
      importance: "essential",
      // Named so it is obvious this covers the H1 too, rather than looking like
      // a check that was forgotten.
      label: "Keyword in the title (also the H1)",
      passed: contains(input.title, keyword),
    },
    {
      id: "keyword-in-slug",
      importance: "essential",
      label: "Keyword in the URL slug",
      passed: slugContains(input.slug, keyword),
    },
    {
      id: "meta-description-set",
      importance: "essential",
      label: "Meta description written",
      passed: (input.metaDescription ?? "").trim().length > 0,
    },
    {
      id: "keyword-in-meta-description",
      importance: "essential",
      label: "Keyword in the meta description",
      passed: contains(input.metaDescription, keyword),
    },

    // --- important --------------------------------------------------------
    {
      id: "keyword-in-first-paragraph",
      importance: "important",
      label: "Keyword in the opening paragraph",
      passed: contains(firstParagraph(body), keyword),
    },
    {
      id: "keyword-in-subheading",
      importance: "important",
      label: "Keyword in a subheading",
      passed: subheadings(body).some((heading) => contains(heading, keyword)),
      detail:
        subheadings(body).length === 0 ? "No subheadings yet" : undefined,
    },
    {
      id: "keyword-density",
      importance: "important",
      label: "Keyword used a sensible number of times",
      passed: density >= DENSITY_MIN && density <= DENSITY_MAX,
      detail:
        words === 0
          ? "No body yet"
          : `${hits} in ${words} words (${(density * 100).toFixed(1)}%)${
              density > DENSITY_MAX ? " — reads as stuffed" : ""
            }`,
    },
    {
      id: "featured-image",
      importance: "important",
      label: "Featured image set",
      passed: (input.featuredImage ?? "").length > 0,
    },

    // --- polish -----------------------------------------------------------
    {
      id: "featured-image-alt",
      importance: "polish",
      label: "Featured image has alt text",
      // Only meaningful with an image; without one this is not a separate
      // failure, it is the same failure as the check above.
      passed:
        (input.featuredImage ?? "").length === 0 ||
        (input.featuredImageAlt ?? "").trim().length > 0,
    },
    {
      id: "body-images-alt",
      importance: "polish",
      label: "Every image in the body has alt text",
      passed: images.length === 0 || imagesWithAlt === images.length,
      detail:
        images.length === 0
          ? "No images in the body"
          : `${imagesWithAlt} of ${images.length}`,
    },
    {
      id: "body-length",
      importance: "polish",
      label: `At least ${MIN_WORDS} words`,
      passed: words >= MIN_WORDS,
      detail: `${words} words`,
    },
    {
      id: "meta-title-length",
      importance: "polish",
      label: `Meta title within ${META_TITLE_LIMIT} characters`,
      passed: effectiveMetaTitle.trim().length <= META_TITLE_LIMIT,
      detail: `${effectiveMetaTitle.trim().length} characters`,
    },
  ];

  const totalWeight = checks.reduce(
    (sum, check) => sum + WEIGHTS[check.importance],
    0
  );
  const passedWeight = checks.reduce(
    (sum, check) => (check.passed ? sum + WEIGHTS[check.importance] : sum),
    0
  );

  return {
    score: totalWeight === 0 ? null : passedWeight / totalWeight,
    checks,
    passed: checks.filter((check) => check.passed).length,
    total: checks.length,
  };
}

export const IMPORTANCE_LABELS: Record<Importance, string> = {
  essential: "Essential",
  important: "Important",
  polish: "Polish",
};

export const IMPORTANCE_ORDER: Importance[] = [
  "essential",
  "important",
  "polish",
];
