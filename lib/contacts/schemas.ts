import { z } from "zod";

// Empty optional fields normalise to null at the schema boundary, the same
// pattern as leads and customers.
const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const optionalText = z.preprocess(
  emptyToNull,
  z.string().trim().max(2000).nullish()
);
const optionalEmail = z.preprocess(emptyToNull, z.email().max(320).nullish());

// A contact belongs to a parent customer. is_primary marks the lead contact;
// the action enforces at most one primary per customer.
export const contactCreateSchema = z.object({
  customer_id: z.uuid(),
  name: z.string().trim().min(1, "Name is required").max(200),
  email: optionalEmail,
  phone: optionalText,
  job_title: optionalText,
  is_primary: z.boolean().optional(),
});

export const contactUpdateSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Name is required").max(200).optional(),
  email: optionalEmail,
  phone: optionalText,
  job_title: optionalText,
  is_primary: z.boolean().optional(),
});

export const contactIdSchema = z.object({ id: z.uuid() });

export const contactCustomerSchema = z.object({ customer_id: z.uuid() });
