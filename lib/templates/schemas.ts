import { z } from "zod";

// Templates schemas (Pass 9A). A template is reusable subject-and-body content
// with {{placeholder}} tokens. category organises templates into a small
// labelled set, mirrored by the CHECK in migration 0034 (extend the two
// together). subject is the optional email subject line; body is required.

export const TEMPLATE_CATEGORIES = [
  "lead_acknowledgement",
  "quote_sent",
  "quote_chase",
  "task_reminder",
  "general",
] as const;

// Display labels for the categories, the single source the list filter and the
// form select both read so a category reads the same everywhere.
export const TEMPLATE_CATEGORY_LABELS: Record<
  (typeof TEMPLATE_CATEGORIES)[number],
  string
> = {
  lead_acknowledgement: "Lead acknowledgement",
  quote_sent: "Quote sent",
  quote_chase: "Quote chase",
  task_reminder: "Task reminder",
  general: "General",
};

// Empty optional fields normalise to null at the schema boundary, so "no value"
// has one representation regardless of caller (the same device leads use).
const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const name = z.string().trim().min(1, "A template needs a name").max(200);
const category = z.enum(TEMPLATE_CATEGORIES);
const subject = z.preprocess(emptyToNull, z.string().trim().max(500).nullish());
const body = z
  .string()
  .trim()
  .min(1, "A template body cannot be empty")
  .max(20000);

export const templateCreateSchema = z.object({ name, category, subject, body });

// Update changes only the provided keys; an absent key means "leave as is".
export const templateUpdateSchema = z.object({
  id: z.uuid(),
  name: name.optional(),
  category: category.optional(),
  subject,
  body: body.optional(),
});

export const templateIdSchema = z.object({ id: z.uuid() });

// List, optionally narrowed to one category.
export const templateListSchema = z.object({
  category: z.enum(TEMPLATE_CATEGORIES).optional(),
});
