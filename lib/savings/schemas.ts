import { z } from "zod";

// Savings schemas (Pass 11A). A savings item records a cancelled subscription:
// a label, the cost saved in integer pence, and the cadence that cost recurred
// at. cadence mirrors the CHECK in migration 0040 (extend the two together, the
// same way the templates categories and the module_key domain move with their
// registries). note and cancelled_on are optional. Empty optional fields
// normalise to null at the schema boundary, so "no value" has one
// representation regardless of caller, and absent fields stay undefined
// (meaning "do not change" on update), the same pattern as leads and templates.

export const SAVINGS_CADENCES = ["monthly", "annual"] as const;

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const label = z.string().trim().min(1, "A savings item needs a label").max(200);

// amount_pence is the cost saved, in whole pence and more than zero (a saving of
// zero or a fraction of a penny is not a real saving).
const amount_pence = z
  .number()
  .int("The amount must be a whole number of pence")
  .positive("The amount must be more than zero");

const cadence = z.enum(SAVINGS_CADENCES);
const note = z.preprocess(emptyToNull, z.string().trim().max(2000).nullish());
const cancelled_on = z.preprocess(emptyToNull, z.iso.date().nullish());

export const savingsCreateSchema = z.object({
  label,
  amount_pence,
  // Absent cadence defaults to monthly (matching the database default), so a
  // workspace can enter either.
  cadence: cadence.default("monthly"),
  note,
  cancelled_on,
});

// Update changes only the provided keys; an absent key means "leave as is".
export const savingsUpdateSchema = z.object({
  id: z.uuid(),
  label: label.optional(),
  amount_pence: amount_pence.optional(),
  cadence: cadence.optional(),
  note,
  cancelled_on,
});

export const savingsIdSchema = z.object({ id: z.uuid() });
