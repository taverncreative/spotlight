import { z } from "zod";

export const POST_STATUSES = ["draft", "published"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

// SEO targets, shared by the editor's counters so the number the operator sees
// and the number scored later cannot drift apart. These are ADVICE: the schema
// caps below are far higher, matching the column constraints in 0066, because
// sometimes the right title is 63 characters and a hard stop would only produce
// a worse one.
export const SEO_LIMITS = {
  metaTitle: 60,
  metaTitleWarnAt: 50,
  metaDescription: 160,
  metaDescriptionWarnAt: 140,
  excerpt: 300,
  excerptWarnAt: 260,
} as const;

export const postFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required."),
  // Blank means "not set": the editor prefills this from the title and only
  // sends a value once it has actually been edited, so a stored meta title is
  // always a deliberate one rather than a stale copy of a headline that has
  // since changed. Cap matches the column constraint in 0066.
  meta_title: z
    .string()
    .trim()
    .max(120, "Keep the meta title under 120 characters.")
    .optional(),
  // The keyword the post is written to rank for, and what the SEO checklist
  // scores everything else against. Blank means "not set", which the checklist
  // treats as "nothing to score" rather than as a failing post.
  focus_keyword: z
    .string()
    .trim()
    .max(120, "Keep the focus keyword under 120 characters.")
    .optional(),
  excerpt: z
    .string()
    .trim()
    .max(500, "Keep the excerpt under 500 characters.")
    .optional(),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required.")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Use lowercase letters, numbers and single hyphens."
    ),
  body: z.string().optional(),
  meta_description: z
    .string()
    .trim()
    .max(300, "Keep the meta description under 300 characters.")
    .optional(),
  featured_image: z.string().optional(),
  featured_image_alt: z
    .string()
    .trim()
    .max(300, "Keep the alt text under 300 characters.")
    .optional(),
});

export type PostFormValues = z.infer<typeof postFormSchema>;

export type PostFormState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
} | null;

export function fieldErrorsFromZod(
  error: z.ZodError
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = typeof issue.path[0] === "string" ? issue.path[0] : "";
    if (!key) continue;
    (result[key] ??= []).push(issue.message);
  }
  return result;
}
