import { z } from "zod";

// Empty optional fields normalise to null at the schema boundary, the same
// pattern as leads and customers: one representation for "no value", and
// absent fields stay undefined (meaning "do not change" on update).
const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const optionalText = z.preprocess(
  emptyToNull,
  z.string().trim().max(2000).nullish()
);

// A site belongs to a parent customer; the customer is the scope, so create
// carries customer_id while update never moves a site between customers.
export const siteCreateSchema = z.object({
  customer_id: z.uuid(),
  name: z.string().trim().min(1, "Name is required").max(200),
  address_line1: optionalText,
  address_line2: optionalText,
  town: optionalText,
  county: optionalText,
  postcode: optionalText,
  access_notes: optionalText,
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

export const siteUpdateSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Name is required").max(200).optional(),
  address_line1: optionalText,
  address_line2: optionalText,
  town: optionalText,
  county: optionalText,
  postcode: optionalText,
  access_notes: optionalText,
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

export const siteIdSchema = z.object({ id: z.uuid() });

export const siteCustomerSchema = z.object({ customer_id: z.uuid() });
