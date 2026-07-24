import { z } from "zod";

// The allocation editor takes hours as a decimal string (e.g. "7.5") and stores
// integer minutes. An empty string clears the allocation back to null ("not
// set"). Bounds keep an accidental keystroke from writing a nonsense retainer.
export const allocationFormSchema = z.object({
  hours: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || /^\d*\.?\d+$/.test(value),
      "Enter hours as a number, e.g. 7.5"
    )
    .transform((value) => (value === "" ? null : Number(value)))
    .refine(
      (value) =>
        value === null ||
        (Number.isFinite(value) && value >= 0 && value <= 1000),
      "Hours must be between 0 and 1000."
    ),
});

export type AllocationFormValues = z.infer<typeof allocationFormSchema>;

export type AllocationFormState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
} | null;

// Start/stop stopwatch actions: no field validation, just a success/error flag.
export type TimerActionState = {
  ok: boolean;
  error?: string;
} | null;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// A manual adjustment: whole hours + minutes and a direction, which the action
// converts to a signed adjust_seconds (subtract => negative). The amount must be
// above zero; the date is a calendar day the correction is attributed to (the
// action anchors it to noon UTC and rejects a future day).
export const adjustmentFormSchema = z
  .object({
    direction: z.enum(["add", "subtract"]),
    hours: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d+$/.test(v), "Whole hours only.")
      .transform((v) => (v === "" ? 0 : parseInt(v, 10)))
      .refine((v) => v >= 0 && v <= 1000, "Hours must be between 0 and 1000."),
    minutes: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d+$/.test(v), "Whole minutes only.")
      .transform((v) => (v === "" ? 0 : parseInt(v, 10)))
      .refine((v) => v >= 0 && v <= 59, "Minutes must be between 0 and 59."),
    date: z
      .string()
      .trim()
      .refine((v) => ISO_DATE.test(v), "Enter a valid date."),
    note: z
      .string()
      .trim()
      .max(500, "Keep the note under 500 characters.")
      .optional(),
  })
  .refine((data) => data.hours * 3600 + data.minutes * 60 > 0, {
    path: ["minutes"],
    message: "Enter an amount above zero.",
  });

export type AdjustmentFormValues = z.infer<typeof adjustmentFormSchema>;

export type AdjustmentFormState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
} | null;

// Field -> messages map from a Zod error, the same helper shape the tasks and
// sites forms use; kept local so lib/time stays self-contained.
export function fieldErrorsFromZod(
  error: z.ZodError
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = typeof issue.path[0] === "string" ? issue.path[0] : "";
    if (!key) continue;
    (result[key] ??= []).push(issue.message);
  }
  return result;
}
