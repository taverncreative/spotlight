// The field mapping for Meta post engagement: the part that is pure, and the
// part Meta keeps changing.
//
// Split out of insights.ts, which is server-only because it handles decrypted
// tokens. This half touches no token, no network and no database, so the mapping
// can be tested directly -- which matters more here than almost anywhere else in
// this codebase, because these field names have already moved once
// (post_impressions is rejected outright on v25.0) and will move again.
//
// WHAT IS AND IS NOT AVAILABLE, verified against the live Graph v25.0 API with a
// real Business Sorted Kent post rather than taken from documentation:
//
//   INSTAGRAM, with instagram_basic which this app already holds:
//     like_count      -> likes     works, real numbers
//     comments_count  -> comments  works
//     shares                       does not exist as a media field at all
//                                  ("Tried accessing nonexisting field")
//
//   FACEBOOK, with pages_read_engagement which this app already holds:
//     shares                       readable, but Meta OMITS the field entirely
//                                  when the count is zero
//     likes / comments / reactions REFUSED. These are USER-generated content and
//                                  need pages_read_user_content, which this app
//                                  does not hold and which requires App Review.
//
// pages_read_engagement IS granted -- confirmed through debug_token -- so the
// Facebook gap is not a scope we forgot to ask for. It is a different permission
// governing a different class of data.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE: an unavailable count is NULL, never 0.
// "Nobody liked it" and "we are not allowed to know" are different statements,
// and only one of them is about the client's performance.

export type PostInsights = {
  likes: number | null;
  comments: number | null;
  shares: number | null;
  raw: Record<string, unknown>;
};

// How long a post stays worth refreshing. Engagement moves for a day or two then
// plateaus; past this a post is history, and re-reading it every six hours spends
// rate limit to watch a number not change.
export const INSIGHTS_WINDOW_DAYS = 28;
// Per run, so a backlog drains over several runs rather than one long request.
export const INSIGHTS_BATCH = 25;

// The exact field lists sent to Meta.
//
// Facebook asks for shares ALONE on purpose. Adding likes or comments makes the
// WHOLE request fail with a permission error rather than returning the one field
// we are allowed -- verified against the live API -- so asking for less is what
// makes Facebook return anything at all.
export const IG_FIELDS = "id,like_count,comments_count";
export const FB_FIELDS = "id,shares";

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function parseInstagramMedia(
  body: Record<string, unknown>
): PostInsights {
  return {
    likes: count(body.like_count),
    comments: count(body.comments_count),
    // Instagram media has no shares field. Null, not 0: we are not being told.
    shares: null,
    raw: body,
  };
}

export function parseFacebookPost(
  body: Record<string, unknown>
): PostInsights {
  // shares is {count: n} when present and ABSENT ENTIRELY when zero. That
  // absence is the one place a 0 is correct in this module, and only because the
  // field being readable is what makes its absence informative.
  const shares = body.shares as { count?: unknown } | undefined;
  return {
    likes: null, // pages_read_user_content
    comments: null, // pages_read_user_content
    shares: shares ? count(shares.count) ?? 0 : 0,
    raw: body,
  };
}

export function parseInsights(
  platform: string,
  body: Record<string, unknown>
): PostInsights | null {
  if (platform === "instagram") return parseInstagramMedia(body);
  if (platform === "facebook") return parseFacebookPost(body);
  return null;
}
