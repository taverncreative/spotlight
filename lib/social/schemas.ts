// Shared types and constants for the Social module.

export type SocialPostFormState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
} | null;

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
