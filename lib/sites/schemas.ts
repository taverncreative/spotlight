import { z } from "zod";

// Check-interval choices for the Sites form. Default is every 15 minutes.
export const INTERVAL_OPTIONS = [
  { minutes: 5, label: "Every 5 minutes" },
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 30, label: "Every 30 minutes" },
  { minutes: 60, label: "Every hour" },
  { minutes: 360, label: "Every 6 hours" },
  { minutes: 1440, label: "Every day" },
] as const;

export const DEFAULT_INTERVAL_MINUTES = 15;

// Add a scheme if the operator typed a bare hostname, so the stored URL is a
// full, fetchable URL.
export function normaliseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// The hostname for display; falls back to the raw value if it will not parse.
export function hostnameFromUrl(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

export const siteFormSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "URL is required.")
    .transform(normaliseUrl)
    .refine(isValidHttpUrl, "Enter a valid URL (e.g. example.com)."),
  label: z.string().trim().max(120).optional(),
  check_interval_minutes: z.coerce
    .number()
    .int()
    .positive("Choose a check interval."),
  monitoring_enabled: z.boolean(),
});

export type SiteFormValues = z.infer<typeof siteFormSchema>;

export type SiteFormState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
} | null;

// Field -> messages map from a Zod error (reads error.issues directly, stable
// across Zod versions).
export function fieldErrorsFromZod(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = typeof issue.path[0] === "string" ? issue.path[0] : "";
    if (!key) continue;
    (result[key] ??= []).push(issue.message);
  }
  return result;
}
