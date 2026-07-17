"use server";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { CaptionErrorCode, CaptionState } from "@/lib/social/schemas";

// Caption generation: rewrite whatever the operator has in the composer's
// caption box into a hook/teaser/CTA social caption.
//
// The API key never leaves this module. "use server" means the body is only ever
// bundled for the server; the composer receives an RPC stub for generateCaption
// and nothing else. The key is read from the environment inside the action, and
// is never returned, logged, or passed to the client. (No "server-only" import
// here: that poisons a module when a client bundle resolves it, which is exactly
// the import the composer must be able to make. "use server" is the guarantee.)

const LIMIT = 10;
const WINDOW_MS = 60_000;
// A sanity bound applied before the Markdown regexes run, not the real limit:
// it only stops an absurd paste being regexed. MAX_SOURCE_WORDS below is what
// actually bounds what Sonnet sees, and so what the input costs.
const MAX_SOURCE_CHARS = 20_000;
// A shared post seeds the whole blog body into the box, which can run long. The
// generator needs enough of it to pull real points from, not the lot: the top of
// a post carries the substance, and input is billed per token.
const MAX_SOURCE_WORDS = 600;

// Sliding window per operator. Deliberately in-memory: Vercel runs several
// lambda instances, each with its own map, and a cold start resets it, so the
// real ceiling is 10 x instances. This is a runaway-loop and double-click guard,
// not a hard cap — max_tokens is the actual cost bound. A true cap would need a
// shared store (a Postgres row or KV), which is a migration or new infra for one
// operator pressing a button.
const hits = new Map<string, number[]>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(userId, recent);
    return true;
  }
  hits.set(userId, [...recent, now]);
  return false;
}

// Markdown to plain text. Good enough to brief a model, not a renderer: the aim
// is to stop syntax eating the word budget and muddling the prose. Order
// matters — fenced code before inline, images before links (an image is a link
// with a bang, so the link rule would otherwise strip the bang and keep the alt
// text as if it were prose).
function markdownToText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`([^`]*)`/g, "$1") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images, alt text and all
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links keep their text, lose the url
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // heading markers
    .replace(/^\s{0,3}>\s?/gm, "") // blockquote markers
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, "") // list markers
    .replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, " ") // horizontal rules
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(\*|_)(.*?)\1/g, "$2") // italic
    .replace(/<[^>]+>/g, " ") // stray html
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Cut to a word budget at a word boundary in the original string, so paragraph
// breaks in the kept portion survive (splitting and rejoining would flatten the
// text into one block and cost the model the structure).
function truncateWords(text: string, limit: number): string {
  const pattern = /\S+/g;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    count += 1;
    if (count === limit) return text.slice(0, match.index + match[0].length);
  }
  return text;
}

// Three beats as separate fields rather than one blob: the schema is what
// enforces the shape, so the prompt does not have to police it.
const CaptionSchema = z.object({
  hook: z.string(),
  teaser: z.string(),
  cta: z.string(),
});

const CAPTION_SYSTEM = `You write social captions for a UK marketing agency, on behalf of its clients. The caption posts to Facebook and Instagram.

The source may be a short note or a whole blog post. Turn it into one caption in three beats:
- hook: one line that earns a scroll-stop. Concrete and specific. Never clickbait, and never a question the source does not answer.
- teaser: one or two sentences carrying the actual substance. When the source runs long, pick the one or two most useful concrete points out of it rather than summarising the whole thing. Say the useful thing outright rather than gesturing at it.
- cta: one short, soft, link-free line inviting a reply, such as "get in touch" or "message us to find out more".

Rules:
- UK English spelling throughout: organise, colour, specialise, centre.
- No em dashes. Use commas or full stops instead.
- No emoji unless the source text implies it.
- Never invent facts, offers, prices, dates or claims that are not in the source.
- The caption is self-contained and there is never a link. Explain the value in the caption itself instead of promising it elsewhere.
- Never write a URL, and never reference a link: no "read more", no "read here", no "the full breakdown is here", no "link below", no "click through". There is nothing for the reader to click.
- At most two hashtags, and only where they earn their place. No hashtag walls.
- Under 80 words across all three beats.`;

// Map an SDK error to one of the four messages. Order matters twice here:
//
// 1. APIConnectionError extends APIError in this SDK (it is a sibling in the
//    Python one), so it must be tested before APIError or every timeout would
//    read as "unknown". Timeouts arrive as its APIConnectionTimeoutError
//    subclass, so they are covered by the same branch.
// 2. Out of credits is not a 429. It arrives as billing_error, usually on a 403
//    and sometimes a 400, so it is matched on .type rather than status —
//    otherwise the most diagnosable failure would get the vaguest message.
function classify(error: unknown): CaptionErrorCode {
  if (error instanceof Anthropic.AuthenticationError) return "auth"; // 401
  if (error instanceof Anthropic.APIError && error.type === "billing_error") {
    return "billing";
  }
  if (error instanceof Anthropic.RateLimitError) return "billing"; // 429
  // 403 that is not billing: the key lacks access, so the key is still the lever.
  if (error instanceof Anthropic.PermissionDeniedError) return "auth";
  if (error instanceof Anthropic.APIConnectionError) return "unavailable";
  if (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500) {
    return "unavailable";
  }
  return "unknown";
}

export async function generateCaption(source: string): Promise<CaptionState> {
  // Authorise explicitly. Every other action in this app is authorised by RLS on
  // the query it makes, but this one touches no table, so RLS would gate
  // nothing: without this check it is an unauthenticated endpoint that spends
  // money on every POST.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "signed_out" };

  // The button disables on an empty caption, but a server action is a public
  // POST endpoint, so it cannot trust the client to have done that.
  //
  // A shared draft seeds the raw Markdown body into the box, so strip it to
  // prose and cut it to the word budget before it reaches the model: Markdown
  // syntax would spend the budget on punctuation, and a long body would bill for
  // context the caption cannot use. Both run on anything the operator typed or
  // pasted too, which is why they live here and not in shareToSocial.
  const brief = truncateWords(
    markdownToText(source.trim().slice(0, MAX_SOURCE_CHARS)),
    MAX_SOURCE_WORDS
  );
  if (!brief) return { ok: false, code: "empty" };

  if (rateLimited(user.id)) return { ok: false, code: "rate" };

  // A missing key is a deploy fault, not a model failure. Checked before the
  // client is constructed, which throws outright on an absent key — at module
  // scope that would be an import-time crash instead of this message, which is
  // why the client is built here rather than once at the top.
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, code: "auth" };

  try {
    const anthropic = new Anthropic({ timeout: 20_000, maxRetries: 1 });
    const response = await anthropic.messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 300,
      // Mandatory on Sonnet 5: omitting this runs adaptive thinking, and
      // max_tokens bounds thinking plus response, so the 300 cap would be spent
      // thinking and return a truncated caption. It would look like a broken
      // feature rather than a misconfiguration.
      thinking: { type: "disabled" },
      system: CAPTION_SYSTEM,
      messages: [{ role: "user", content: brief }],
      output_config: { format: zodOutputFormat(CaptionSchema) },
    });

    // A refusal, a truncation, or a response that misses the schema is a 200 and
    // never throws, so it does not reach classify().
    const parts = response.parsed_output;
    if (!parts || response.stop_reason !== "end_turn") {
      return { ok: false, code: "model" };
    }

    // No link is appended: a social caption is self-contained. A URL in the
    // source is context for the model, not something to carry into the output,
    // and the prompt forbids it writing one.
    const caption = [parts.hook, parts.teaser, parts.cta]
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n");
    if (!caption) return { ok: false, code: "model" };

    return { ok: true, caption };
  } catch (error) {
    return { ok: false, code: classify(error) };
  }
}
