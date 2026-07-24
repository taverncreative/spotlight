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
