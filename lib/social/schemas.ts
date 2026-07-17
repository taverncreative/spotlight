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

// Images only for now (the schema allows 'video' for later). Mirrors the
// post-images limits, a touch larger for carousel photos.
export const ALLOWED_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024; // 10 MB

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
};
