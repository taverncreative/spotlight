import { z } from "zod";

// The client status set, shared by the Zod schema, the management UI and the DB
// check constraint. KEEP IN SYNC with migration 0008_clients_status_paused.sql.
export const CLIENT_STATUSES = ["active", "paused", "archived"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  active: "Active",
  paused: "Paused",
  archived: "Archived",
};

// Derive a URL-safe slug from a name: lowercase, non-alphanumerics to hyphens,
// collapse runs, trim leading/trailing hyphens.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const clientFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required.")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Use lowercase letters, numbers and single hyphens."
    ),
  status: z.enum(CLIENT_STATUSES),
});

export type ClientFormValues = z.infer<typeof clientFormSchema>;

// Form-action result consumed by useActionState in the client form. ok=true on
// a successful save; otherwise a top-level error and/or per-field errors.
export type ClientFormState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
} | null;

// Build a field -> messages map from a Zod error. Reads error.issues directly
// (stable across Zod versions) rather than the changing flatten helpers.
export function fieldErrorsFromZod(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = typeof issue.path[0] === "string" ? issue.path[0] : "";
    if (!key) continue;
    (result[key] ??= []).push(issue.message);
  }
  return result;
}
