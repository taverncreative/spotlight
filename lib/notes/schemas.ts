import { z } from "zod";

// Notes schemas (Pass 7A). A note is free text attached to a record, so unlike
// tasks the polymorphic link is mandatory: related_type and related_id are both
// required on create and on listing. The body is required and non-empty; that
// the referenced record exists in the organisation is an application-layer
// check in the actions, standing in for the absent foreign key.

export const RELATED_TYPES = [
  "lead",
  "customer",
  "site",
  "quote",
  "job",
] as const;

const noteBody = z
  .string()
  .trim()
  .min(1, "A note cannot be empty")
  .max(10000);

export const noteCreateSchema = z.object({
  related_type: z.enum(RELATED_TYPES),
  related_id: z.uuid(),
  body: noteBody,
});

// Update edits the body only; the record a note belongs to is fixed at
// creation (there is no action to move a note between records).
export const noteUpdateSchema = z.object({
  id: z.uuid(),
  body: noteBody,
});

export const noteIdSchema = z.object({ id: z.uuid() });

// List a single record's notes (the related pair, both required).
export const noteListSchema = z.object({
  related_type: z.enum(RELATED_TYPES),
  related_id: z.uuid(),
});
