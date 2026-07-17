"use server";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { CaptionState } from "@/lib/social/schemas";

// Caption generation: rewrite whatever the operator has in the composer's
// caption box into a hook/teaser/CTA social caption.
//
// The API key never leaves this module. "use server" means the body is only ever
// bundled for the server; the composer receives an RPC stub for generateCaption
// and nothing else. The key is read from the environment inside the action, and
// is never returned, logged, or passed to the client. (No "server-only" import
// here: that poisons a module when a client bundle resolves it, which is exactly
// the import the composer must be able to make. "use server" is the guarantee.)

// The four failure messages, John's wording kept verbatim: each names the lever
// he can pull.
const AUTH = "Your Anthropic API key is invalid or expired, set a new one.";
const BILLING =
  "Your Anthropic account is rate-limited or out of credits, check billing.";
const UNAVAILABLE = "Caption generation is temporarily unavailable, try again.";
const UNKNOWN =
  "Couldn't generate a caption. Check your API key is valid and in date, and that your account has credits.";

// Two failures that cannot honestly use any of the four. Our own rate limit is
// not Anthropic's, so it must not send him to check billing for a cap we
// imposed; and a refusal or an unparseable/truncated response is a 200 with no
// exception to classify, so blaming the key would send him after a key that is
// fine.
const RATE = "Ten captions a minute, max. Give it a moment and try again.";
const MODEL =
  "The model didn't return a usable caption. Try again, or adjust the source text.";

const LIMIT = 10;
const WINDOW_MS = 60_000;
// The composer caption is the only context, and it is a caption box: anything
// past this is paste-bombing, and max_tokens already bounds the output cost.
const MAX_SOURCE_CHARS = 4000;

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

// The first URL in the source, held out of the model's reach and re-attached
// verbatim afterwards. Asking a model to reproduce a URL exactly invites it to
// paraphrase or shorten one; not letting it write one at all makes the live post
// link (Slice A) byte-exact by construction.
function firstUrl(source: string): string {
  return source.match(/https?:\/\/\S+/)?.[0] ?? "";
}

// Three beats as separate fields rather than one blob: the schema is what
// enforces the shape, so the prompt does not have to police it.
const CaptionSchema = z.object({
  hook: z.string(),
  teaser: z.string(),
  cta: z.string(),
});

const CAPTION_SYSTEM = `You write social captions for a UK marketing agency, on behalf of its clients. The caption posts to Facebook and Instagram.

Rewrite the source text into one caption in three beats:
- hook: one line that earns a scroll-stop. Concrete and specific. Never clickbait, and never a question the source does not answer.
- teaser: one or two sentences on what the reader gets. Specific beats vague.
- cta: one short line telling the reader what to do next.

Rules:
- UK English spelling throughout: organise, colour, specialise, centre.
- No em dashes. Use commas or full stops instead.
- No emoji unless the source text implies it.
- Never invent facts, offers, prices, dates or claims that are not in the source.
- Never write a URL yourself.
- At most two hashtags, and only where they earn their place. No hashtag walls.
- Under 80 words across all three beats.`;

// Whether there is a link is resolved in code, not left to the model to infer:
// firstUrl() has already run by the time the prompt is built, so it can state
// the case outright rather than describe both and hope.
//
// This is the fix for captions that promised "read the full post below" with
// nothing below them. The rule used to say a link was appended automatically,
// full stop, when in fact one is only appended if the source carried a URL, so
// on a link-free source the model was being told to write a cta pointing at
// something that would never arrive.
const LINK_RULE = `A link is appended on its own line after your text. The cta may drive to it and should read naturally before it.`;

const NO_LINK_RULE = `There is no link, and none will be appended. The caption must stand on its own: deliver the value in the teaser rather than promising it elsewhere, and end with a link-free cta such as "get in touch" or "drop us a message". Never write "read more", "read here", "the full breakdown is here", "click below", or anything else that points the reader at a link they will not find.`;

// Map an SDK error to one of the four messages. Order matters twice here:
//
// 1. APIConnectionError extends APIError in this SDK (it is a sibling in the
//    Python one), so it must be tested before APIError or every timeout would
//    read as "unknown". Timeouts arrive as its APIConnectionTimeoutError
//    subclass, so they are covered by the same branch.
// 2. Out of credits is not a 429. It arrives as billing_error, usually on a 403
//    and sometimes a 400, so it is matched on .type rather than status —
//    otherwise the most diagnosable failure would get the vaguest message.
function classify(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return AUTH; // 401
  if (error instanceof Anthropic.APIError && error.type === "billing_error") {
    return BILLING;
  }
  if (error instanceof Anthropic.RateLimitError) return BILLING; // 429
  // 403 that is not billing: the key lacks access, so the key is still the lever.
  if (error instanceof Anthropic.PermissionDeniedError) return AUTH;
  if (error instanceof Anthropic.APIConnectionError) return UNAVAILABLE;
  if (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500) {
    return UNAVAILABLE;
  }
  return UNKNOWN;
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
  if (!user) return { ok: false, error: "Sign in to generate a caption." };

  // The button disables on an empty caption, but a server action is a public
  // POST endpoint, so it cannot trust the client to have done that.
  const brief = source.trim().slice(0, MAX_SOURCE_CHARS);
  if (!brief) return { ok: false, error: "Add a topic or notes first." };

  if (rateLimited(user.id)) return { ok: false, error: RATE };

  // A missing key is a deploy fault, not a model failure. Checked before the
  // client is constructed, which throws outright on an absent key — at module
  // scope that would be an import-time crash instead of this message, which is
  // why the client is built here rather than once at the top.
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: AUTH };

  const link = firstUrl(brief);

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
      system: `${CAPTION_SYSTEM}\n\n${link ? LINK_RULE : NO_LINK_RULE}`,
      messages: [{ role: "user", content: brief }],
      output_config: { format: zodOutputFormat(CaptionSchema) },
    });

    // A refusal, a truncation, or a response that misses the schema is a 200 and
    // never throws, so it does not reach classify().
    const parts = response.parsed_output;
    if (!parts || response.stop_reason !== "end_turn") {
      return { ok: false, error: MODEL };
    }

    const caption = [parts.hook, parts.teaser, parts.cta, link]
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n");
    if (!caption) return { ok: false, error: MODEL };

    return { ok: true, caption };
  } catch (error) {
    return { ok: false, error: classify(error) };
  }
}
