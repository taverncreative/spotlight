import { z } from "zod";

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "converted",
  "rejected",
  "spam",
] as const;

// Empty optional fields normalise to null at the schema boundary, so "no
// value" has exactly one representation in the database regardless of
// caller. Absent fields stay undefined (meaning "do not change" on update).
const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const optionalText = z.preprocess(
  emptyToNull,
  z.string().trim().max(2000).nullish()
);
const optionalEmail = z.preprocess(emptyToNull, z.email().max(320).nullish());

export const leadCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: optionalEmail,
  phone: optionalText,
  message: optionalText,
  source: optionalText,
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

export const leadUpdateSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Name is required").max(200).optional(),
  email: optionalEmail,
  phone: optionalText,
  message: optionalText,
  source: optionalText,
  status: z.enum(LEAD_STATUSES).optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

export const leadIdSchema = z.object({ id: z.uuid() });

export const leadListFilterSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
});
