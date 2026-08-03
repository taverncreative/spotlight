// Shared types and constants for the Social module.

export type SocialPostFormState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
} | null;

// Caption generator failures, as codes rather than messages.
//
// Two reasons they live here and travel as codes. A "use server" module may only
// export async functions, so the messages cannot sit beside the generator in
// caption.ts and still be readable by the composer. And shareToSocial is a plain
// form action: it cannot return a result, so it hands its failure to the
// composer through the redirect URL, where a short code round-trips safely and a
// raw message would let any crafted URL put words in the app's mouth.
export const CAPTION_ERROR_CODES = [
  "auth",
  "billing",
  "unavailable",
  "unknown",
  "rate",
  "model",
  "signed_out",
  "empty",
] as const;
export type CaptionErrorCode = (typeof CAPTION_ERROR_CODES)[number];

// The first four are John's wording, kept verbatim: each names the lever he can
// pull. "rate" and "model" cannot honestly use any of them — our own limit is
// not Anthropic's and must not send him to check billing for a cap we imposed,
// and a refusal or truncation is a 200 that never reaches classify(), so blaming
// the key would send him after a key that is fine.
export const CAPTION_ERROR_MESSAGES: Record<CaptionErrorCode, string> = {
  auth: "Your Anthropic API key is invalid or expired, set a new one.",
  billing:
    "Your Anthropic account is rate-limited or out of credits, check billing.",
  unavailable: "Caption generation is temporarily unavailable, try again.",
  unknown:
    "Couldn't generate a caption. Check your API key is valid and in date, and that your account has credits.",
  rate: "Ten captions a minute, max. Give it a moment and try again.",
  model:
    "The model didn't return a usable caption. Try again, or adjust the source text.",
  signed_out: "Sign in to generate a caption.",
  empty: "Add a topic or notes first.",
};

// Resolve a code that arrived from a URL. An unknown one yields null rather than
// being shown, so only messages this app wrote can ever reach the operator.
export function captionErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return CAPTION_ERROR_MESSAGES[code as CaptionErrorCode] ?? null;
}

// Result of the caption generator, consumed by the composer's Generate button
// and by shareToSocial. A discriminated union rather than the shape above: the
// caption is only ever read on success. The generator never throws, so this
// covers all of its outcomes.
export type CaptionState =
  | { ok: true; caption: string }
  | { ok: false; code: CaptionErrorCode };

export const SOCIAL_MEDIA_BUCKET = "social-media";

// What the social-media bucket accepts, and it must stay in step with 0082:
// the bucket enforces the same list, so a type allowed here and not there fails
// at upload with a storage error instead of a sentence the operator can act on.
export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
// mp4 is what Meta recommends for Reels on both platforms; quicktime is what
// phones produce. Nothing else: webm and mkv are refused by Meta, so accepting
// them would move the rejection from here to an opaque Graph error minutes into
// publishing.
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime"];
export const ALLOWED_MEDIA_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_VIDEO_TYPES,
];

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
// THE BINDING LIMIT, and it is not ours. Supabase's Free Plan caps uploads at
// 50 MB per file, project-wide, above whatever a bucket allows. It is fixed and
// not configurable, so this is the real ceiling for video until the plan
// changes.
//
// The social-media bucket is deliberately left at 200 MB (0082) rather than
// lowered to match. The bucket limit is not wrong -- it is what we would want
// and what applies the day the plan changes -- and lowering it would mean a
// migration to encode somebody else's billing tier into our schema.
//
// This cost a bad diagnosis. 0082 was verified with an 11 MB file, which clears
// both the old bucket limit AND the plan cap, so the test could not tell them
// apart; a 111 MB video then failed instantly with a 413 that nothing surfaced.
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB, Supabase Free Plan

// Kept for callers that predate the split.
export const MAX_MEDIA_BYTES = MAX_IMAGE_BYTES;

// What Meta will accept, checked in the browser so a rejection arrives in
// seconds rather than after a long upload and a publish attempt.
//
// REELS RULES ARE WARNINGS, NOT BLOCKS. 3-90 seconds and 9:16 are Reels
// requirements; feed video allows longer and other ratios, and feed video is a
// later slice. Blocking on them now would refuse footage that is perfectly
// valid for where it is going.
export const VIDEO_MIN_SECONDS = 3;
export const REELS_MAX_SECONDS = 90;
export const VIDEO_MAX_SECONDS = 15 * 60;
// 9:16 is 0.5625. The tolerance covers 1080x1920 against 1079x1920 and the like.
export const REELS_ASPECT = 9 / 16;
export const REELS_ASPECT_TOLERANCE = 0.02;

// THE TEST FOR BLOCKING IS WHOSE RULE IT IS, not how strongly we feel about it.
//
// A story's duration cap blocks because META enforces it: send 75 seconds and
// the publish fails, so letting it through buys a long upload and a failure
// inside a cron hours later.
//
// A story's 9:16 only warns, because Meta does NOT enforce it: Instagram accepts
// other ratios and letterboxes them. This was blocking at first, on the
// reasoning that 9:16 IS the format -- which was us refusing something the
// platform would have taken. Reporting what will happen and leaving the choice
// is the honest version, and it is the same reason the sub-540x960 rule has
// always been a warning.
//
// 60 seconds, not the Reels 90. Meta caps a story at 60 on both platforms.
export const STORY_MAX_SECONDS = 60;

// What a post IS, mirroring social_posts.format (0085). A Reel is deliberately
// not here: it is derived at publish time from the media rather than chosen.
export const POST_FORMATS = ["feed", "story"] as const;
export type PostFormat = (typeof POST_FORMATS)[number];

export function isPostFormat(value: unknown): value is PostFormat {
  return (
    typeof value === "string" && POST_FORMATS.includes(value as PostFormat)
  );
}

export const SOCIAL_STATUSES = [
  "draft",
  "scheduled",
  "publishing",
  "published",
  "partial",
  "failed",
] as const;
export type SocialStatus = (typeof SOCIAL_STATUSES)[number];

// One carousel item, exchanged between the composer and the save action
// (serialised into the form). storage_path is the object path in the
// social-media bucket; position is the array order on save (0-based).
export type SocialMediaItem = {
  storage_path: string;
  media_type: "image" | "video";
  width: number | null;
  height: number | null;
  // A still captured from the video at upload, so every surface that renders an
  // <img> has something to show. Null for images, and for videos uploaded before
  // 0083.
  poster_path?: string | null;
};
