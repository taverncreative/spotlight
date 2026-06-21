import { z } from "zod";

export const CUSTOMER_TYPES = ["business", "individual"] as const;

// Empty optional fields normalise to null at the schema boundary, exactly
// as the leads schemas do: one representation for "no value", and absent
// fields stay undefined (meaning "do not change" on update).
const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const optionalText = z.preprocess(
  emptyToNull,
  z.string().trim().max(2000).nullish()
);
const optionalEmail = z.preprocess(emptyToNull, z.email().max(320).nullish());

export const customerCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  type: z.enum(CUSTOMER_TYPES).optional(),
  email: optionalEmail,
  phone: optionalText,
  address_line1: optionalText,
  address_line2: optionalText,
  town: optionalText,
  county: optionalText,
  postcode: optionalText,
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

export const customerUpdateSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Name is required").max(200).optional(),
  type: z.enum(CUSTOMER_TYPES).optional(),
  email: optionalEmail,
  phone: optionalText,
  address_line1: optionalText,
  address_line2: optionalText,
  town: optionalText,
  county: optionalText,
  postcode: optionalText,
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

export const customerIdSchema = z.object({ id: z.uuid() });

export const customerListFilterSchema = z.object({
  type: z.enum(CUSTOMER_TYPES).optional(),
});
