// The SEO checklist: a post scored against its focus keyword.
//
// A PURE function over already-gathered values. No database, no clock, no React,
// so a post always scores the same and the rules are testable without a browser.
// Anything needing the clock (how old a post is) is passed in.
//
// REWRITTEN against researched guidance rather than checklist convention, which
// changed what is here and what each thing claims:
//
//   * Meta description checks affect CLICK-THROUGH, not ranking, and Google
//     rewrites the description more often than it keeps it. Saying "meta
//     description missing" next to "keyword missing from title" as though they
//     were the same kind of problem is how a checklist teaches you to ignore it.
//   * Meta title length is DISPLAY HYGIENE. Nothing is truncated by a rule and
//     nothing ranks worse at 61 characters.
//   * Keyword in the slug is real but minor, and is Polish for a reason: the URL
//     of a published post should not be changed to satisfy it. A changed URL
//     costs real traffic; a keyword in the slug earns almost none.
//   * Keyword density has NO LOWER BOUND. There is no minimum number of times a
//     keyword must appear and no target range; writing to hit one produces worse
//     prose. The only remaining test is one-directional, for over-repetition.
//   * WORD COUNT IS NOT A RANKING FACTOR and the 300-word check is gone. What
//     replaced it is a judgement prompt about whether the post answers the
//     question, plus a 50-word floor that exists to catch an unfinished draft and
//     says so.
//
// H1 IS THE TITLE. Checked against the real data: no post body contains an `# `
// heading, because client sites render the title as the H1 and bodies start at
// `##`. A separate H1 check would be the title check under another name.

export type Importance = "essential" | "important" | "polish" | "judgement";

// Three states, because "is not a score" is different from failing. Only pass
// and fail reach the arithmetic; note leaves the divisor entirely, the same way
// health.ts excludes services a client is not on. A prompt nobody has answered
// must not look like a failure.
//
// There was briefly a fourth, "pending", for the Article check while structured
// data did not exist. Structured data shipped, Article became a note, and the
// state went with it rather than sitting here unused.
export type CheckStatus = "pass" | "fail" | "note";

export type SeoCheck = {
  id: string;
  importance: Importance;
  label: string;
  status: CheckStatus;
  detail?: string;
};

export type SeoScoreResult = {
  score: number | null;
  checks: SeoCheck[];
  passed: number;
  // Scoreable checks only, so "8 of 11" never counts prompts the writer cannot
  // tick.
  total: number;
};

export type SeoInput = {
  focusKeyword: string | null;
  title: string;
  metaTitle: string | null;
  slug: string;
  metaDescription: string | null;
  body: string | null;
  featuredImage: string | null;
  featuredImageAlt: string | null;
  // The client's own hosts, for telling an internal link from an external one.
  // siteUrls carries the weight: blog_base_url is unset on every client today.
  siteUrls: string[];
  blogBaseUrl: string | null;
  // The structured data the OPERATOR authored. Article is not in here and never
  // will be: it is composed at read time from the post's own fields, so every
  // published post has one by construction. See lib/posts/structured-data.ts.
  schemas: { type: string }[];
  // Days since publication, or null for a draft. Passed in so the clock stays
  // out of a pure function; only decides whether the "still accurate" prompt
  // appears at all.
  ageDays: number | null;
};

const WEIGHTS: Record<Importance, number> = {
  essential: 3,
  important: 2,
  polish: 1,
  judgement: 0,
};

// The ONLY density rule left. No floor: there is no minimum number of mentions,
// and a checklist that asks for one is asking you to write worse.
//
// The ceiling is deliberately HIGH. Genuinely stuffed copy repeats a phrase far
// past this; ordinary prose about one subject sits well under it. A 3% ceiling
// flagged a perfectly normal short post during testing, which is exactly the
// false positive that teaches you to ignore the checklist.
const DENSITY_CEILING = 0.05; // 5%
// Density is meaningless on short text: two mentions in thirty words is 6.7% and
// says nothing. Below this the check passes without judging.
const DENSITY_MIN_WORDS = 100;
// Not an SEO threshold. A post under this is a draft someone stopped writing.
const DRAFT_FLOOR_WORDS = 50;
const META_TITLE_DISPLAY = 60;
// Old enough that "is this still true" is worth asking.
const STALE_AFTER_DAYS = 180;

// --- text helpers ---------------------------------------------------------

// For PROSE. Case, smart quotes and word-joining punctuation are all noise when
// asking "does this phrase appear here": nobody writing "half-price balayage"
// means something different from "half price balayage", and a checklist that
// says the keyword is missing from a title it is plainly in is worse than no
// checklist.
//
// Hyphen, underscore, slash and both dashes become spaces. SENTENCE punctuation
// deliberately does NOT: treating a comma or full stop as a separator would make
// "...after your balayage. Aftercare starts..." match the phrase "balayage
// aftercare", which is a false positive, and a checklist that lies in the
// passing direction is worse than one that lies in the failing direction.
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[-_/–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contains(haystack: string | null, keyword: string): boolean {
  if (!haystack) return false;
  return normalise(haystack).includes(normalise(keyword));
}

// For SLUGS, where separators carry no meaning at all. Every separator is
// dropped from both sides rather than converted, so one comparison covers
// balayage-aftercare, balayage_aftercare and balayageaftercare, and survives a
// keyword whose punctuation the slug dropped ("stylist's balayage" ->
// stylists-balayage), which converting to hyphens could not.
//
// Collapsing separators can match across a word boundary ("ash blonde" inside
// wash-blonde). Substring matching could already do that, it is far rarer than
// the false negatives this removes, and this is a Polish check either way.
function flatten(value: string): string {
  return normalise(value).replace(/[^a-z0-9]+/g, "");
}

function slugContains(slug: string, keyword: string): boolean {
  const needle = flatten(keyword);
  return needle.length > 0 && flatten(slug).includes(needle);
}

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
  return prose ? prose.split(/\s+/).length : 0;
}

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

type Heading = { level: number; text: string };

function headings(markdown: string | null): Heading[] {
  if (!markdown) return [];
  return [...markdown.matchAll(/^(#{1,6})\s+(.*)$/gm)].map((match) => ({
    level: match[1].length,
    text: match[2].trim(),
  }));
}

function markdownImages(markdown: string | null): string[] {
  if (!markdown) return [];
  return [...markdown.matchAll(/!\[([^\]]*)\]\([^)]*\)/g)].map(
    (match) => match[1] ?? ""
  );
}

// Links, excluding images (which are the same syntax with a leading !).
function markdownLinks(markdown: string | null): string[] {
  if (!markdown) return [];
  return [...markdown.matchAll(/(^|[^!])\[[^\]]*\]\(([^)\s]+)/g)].map(
    (match) => match[2]
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
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

// --- individual rules -----------------------------------------------------

// One H1 (the title, not in the body), and no level skipped on the way down.
// Returns null when sound, or the first fault found.
function headingFault(list: Heading[]): string | null {
  if (list.length === 0) return null;
  if (list.some((heading) => heading.level === 1)) {
    return "The body has its own H1; the title is already the H1";
  }
  if (list[0].level > 2) {
    return `Starts at H${list[0].level}, should start at H2`;
  }
  for (let i = 1; i < list.length; i++) {
    const from = list[i - 1].level;
    const to = list[i].level;
    if (to > from + 1) return `H${from} jumps to H${to}, skipping a level`;
  }
  return null;
}

function classifyLinks(input: SeoInput): { internal: number; external: number } {
  const ownHosts = new Set<string>();
  for (const url of input.siteUrls) {
    const host = hostOf(url);
    if (host) ownHosts.add(host);
  }
  if (input.blogBaseUrl) {
    const host = hostOf(input.blogBaseUrl);
    if (host) ownHosts.add(host);
  }

  let internal = 0;
  let external = 0;
  for (const href of markdownLinks(input.body)) {
    if (href.startsWith("#")) continue; // an anchor is not a link off the page
    const host = hostOf(href);
    if (host === null) {
      // Relative: same site by definition.
      internal++;
    } else if (ownHosts.has(host)) {
      internal++;
    } else {
      external++;
    }
  }
  return { internal, external };
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
  const withAlt = images.filter((alt) => alt.trim().length > 0).length;
  const list = headings(body);
  const fault = headingFault(list);
  const links = classifyLinks(input);
  const faqCount = input.schemas.filter(
    (entry) => (entry.type ?? "").toLowerCase() === "faqpage"
  ).length;

  const yes = (condition: boolean): CheckStatus => (condition ? "pass" : "fail");

  const checks: SeoCheck[] = [
    // --- essential --------------------------------------------------------
    {
      id: "keyword-in-title",
      importance: "essential",
      label: "Keyword in the title (also the H1)",
      status: yes(contains(input.title, keyword)),
    },
    {
      id: "keyword-in-first-paragraph",
      importance: "essential",
      label: "Keyword in the opening paragraph",
      status: yes(contains(firstParagraph(body), keyword)),
    },
    {
      id: "meta-description-set",
      importance: "essential",
      label: "Meta description written",
      status: yes((input.metaDescription ?? "").trim().length > 0),
      detail:
        "Affects click-through, not ranking. Google rewrites it more often than it keeps it.",
    },
    {
      id: "keyword-in-meta-description",
      importance: "essential",
      label: "Keyword in the meta description",
      status: yes(contains(input.metaDescription, keyword)),
      detail: "Helps the snippet match the search, when Google keeps yours.",
    },

    // --- important --------------------------------------------------------
    {
      id: "heading-hierarchy",
      importance: "important",
      label: "Headings nest logically",
      status: yes(fault === null),
      detail: fault ?? (list.length === 0 ? "No headings yet" : undefined),
    },
    {
      id: "keyword-in-subheading",
      importance: "important",
      label: "Keyword in a subheading",
      status: yes(list.some((heading) => contains(heading.text, keyword))),
      detail: list.length === 0 ? "No subheadings yet" : undefined,
    },
    {
      id: "internal-links",
      importance: "important",
      label: "Links to the client's own site",
      status: yes(links.internal > 0),
      detail:
        input.siteUrls.length === 0 && !input.blogBaseUrl
          ? "No site on record to link to yet"
          : `${links.internal} internal, ${links.external} external`,
    },
    {
      id: "featured-image",
      importance: "important",
      label: "Featured image set",
      status: yes((input.featuredImage ?? "").length > 0),
    },

    // --- polish -----------------------------------------------------------
    {
      id: "keyword-not-stuffed",
      importance: "polish",
      label: "Keyword not over-repeated",
      // ONE-DIRECTIONAL. Under-use is not a fault and has no threshold here.
      // Short posts are not judged at all: see DENSITY_MIN_WORDS.
      status: yes(words < DENSITY_MIN_WORDS || density <= DENSITY_CEILING),
      detail:
        words === 0
          ? undefined
          : words >= DENSITY_MIN_WORDS && density > DENSITY_CEILING
            ? `${hits} in ${words} words (${(density * 100).toFixed(1)}%) — reads as stuffed`
            : `${hits} in ${words} words`,
    },
    {
      id: "meta-title-length",
      importance: "polish",
      label: "Meta title fits the search result display",
      status: yes(effectiveMetaTitle.trim().length <= META_TITLE_DISPLAY),
      detail: `${effectiveMetaTitle.trim().length} characters. Display hygiene, not a limit or a ranking rule.`,
    },
    {
      id: "keyword-in-slug",
      importance: "polish",
      label: "Keyword in the URL slug (low priority)",
      status: yes(slugContains(input.slug, keyword)),
      detail: "Never change a published URL for this.",
    },
    {
      id: "featured-image-alt",
      importance: "polish",
      label: "Featured image has alt text",
      status: yes(
        (input.featuredImage ?? "").length === 0 ||
          (input.featuredImageAlt ?? "").trim().length > 0
      ),
    },
    {
      id: "body-images-alt",
      importance: "polish",
      label: "Every image in the body has alt text",
      status: yes(images.length === 0 || withAlt === images.length),
      detail:
        images.length === 0 ? undefined : `${withAlt} of ${images.length}`,
    },
    {
      id: "has-content",
      importance: "polish",
      label: "Post has actual content",
      status: yes(words >= DRAFT_FLOOR_WORDS),
      detail: `${words} words. A draft check, not an SEO one: length is not a ranking factor.`,
    },

    // --- judgement, never scored ------------------------------------------
    {
      id: "intent",
      importance: "judgement",
      label: `Does this match what someone searching “${keyword}” actually wants?`,
      status: "note",
    },
    {
      id: "answers-directly",
      importance: "judgement",
      label: "Does it answer the question near the top, before the detail?",
      status: "note",
    },
    {
      id: "first-hand",
      importance: "judgement",
      label: "Does it show first-hand experience or local knowledge?",
      status: "note",
    },
    {
      id: "plain-english",
      importance: "judgement",
      label: "Is it plain English and scannable?",
      status: "note",
    },
    {
      id: "schema-article",
      importance: "judgement",
      label: "Article schema is emitted automatically",
      // A NOTE, not a scored check, and this is deliberate.
      //
      // Article is composed from the post's own fields, so it is present on
      // every published post and a pass/fail row could never fail -- a check
      // that cannot fail is noise in a list that was just rewritten to remove
      // noise. Scoring its COMPLETENESS instead was the obvious alternative and
      // is worse: headline, image and date are each already checked above, so it
      // would charge the same missing featured image three times.
      status: "note",
      detail:
        faqCount > 0
          ? `Plus an FAQ with ${faqCount} ${faqCount === 1 ? "question" : "questions"}.`
          : "Built from the title, description, image and dates.",
    },
    {
      id: "external-links",
      importance: "judgement",
      label: "External links",
      status: "note",
      detail:
        links.external === 0
          ? "None. Not a target, just worth knowing."
          : `${links.external} to other sites.`,
    },
  ];

  // Only asked once a post is old enough for the answer to have changed.
  if (input.ageDays !== null && input.ageDays >= STALE_AFTER_DAYS) {
    checks.push({
      id: "still-accurate",
      importance: "judgement",
      label: "Is this still accurate?",
      status: "note",
      detail: `Published ${Math.round(input.ageDays / 30)} months ago.`,
    });
  }

  // Notes are excluded from BOTH sides, so a prompt can never drag a score down
  // for something the writer has not been asked to tick.
  const scoreable = checks.filter(
    (check) => check.status === "pass" || check.status === "fail"
  );
  const totalWeight = scoreable.reduce(
    (sum, check) => sum + WEIGHTS[check.importance],
    0
  );
  const passedWeight = scoreable.reduce(
    (sum, check) =>
      check.status === "pass" ? sum + WEIGHTS[check.importance] : sum,
    0
  );

  return {
    score: totalWeight === 0 ? null : passedWeight / totalWeight,
    checks,
    passed: scoreable.filter((check) => check.status === "pass").length,
    total: scoreable.length,
  };
}

export const IMPORTANCE_LABELS: Record<Importance, string> = {
  essential: "Essential",
  important: "Important",
  polish: "Polish",
  judgement: "Worth checking",
};

export const IMPORTANCE_ORDER: Importance[] = [
  "essential",
  "important",
  "polish",
  "judgement",
];
