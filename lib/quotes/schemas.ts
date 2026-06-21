import { z } from "zod";

export const QUOTE_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
] as const;

// Empty optional fields normalise to null at the schema boundary, as
// established; absent fields stay undefined and mean "do not change".
const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const optionalText = z.preprocess(
  emptyToNull,
  z.string().trim().max(2000).nullish()
);
const optionalDate = z.preprocess(emptyToNull, z.iso.date().nullish());

export const quoteCreateSchema = z.object({
  customer_id: z.uuid(),
  title: optionalText,
  valid_until: optionalDate,
});

// Status is deliberately absent: status changes flow only through
// transitionQuoteStatus and its transition map. site_id sets or clears the
// quote's site: a uuid sets it, an empty value (normalised to null) clears it,
// and an absent key means "do not change", as with the other optional fields.
export const quoteUpdateSchema = z.object({
  id: z.uuid(),
  customer_id: z.uuid().optional(),
  title: optionalText,
  valid_until: optionalDate,
  site_id: z.preprocess(emptyToNull, z.uuid().nullish()),
});

export const quoteIdSchema = z.object({ id: z.uuid() });

export const quoteTransitionSchema = z.object({
  id: z.uuid(),
  to: z.enum(QUOTE_STATUSES),
});

export const quoteListFilterSchema = z.object({
  status: z.enum(QUOTE_STATUSES).optional(),
});

// Line items. line_total_pence is never accepted as input: the database
// computes it. quantity matches numeric(10,2); vat_rate is a percentage.
export const lineItemAddSchema = z.object({
  quote_id: z.uuid(),
  description: z.string().trim().min(1, "Description is required").max(2000),
  quantity: z.number().positive().max(99999999).optional(),
  unit_price_pence: z.number().int(),
  vat_rate: z.number().min(0).max(100).optional(),
});

export const lineItemUpdateSchema = z.object({
  id: z.uuid(),
  description: z
    .string()
    .trim()
    .min(1, "Description is required")
    .max(2000)
    .optional(),
  quantity: z.number().positive().max(99999999).optional(),
  unit_price_pence: z.number().int().optional(),
  vat_rate: z.number().min(0).max(100).optional(),
});

export const lineItemIdSchema = z.object({ id: z.uuid() });
