import { z } from "zod";
import { RECURRENCE_VALUES } from "@/lib/tasks/recurrence";

// A native <input type="date"> yields "" or a YYYY-MM-DD string.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const taskFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title is required.")
      .max(200, "Keep the title under 200 characters."),
    notes: z
      .string()
      .trim()
      .max(5000, "Keep notes under 5000 characters.")
      .optional(),
    due_date: z
      .string()
      .trim()
      .refine(
        (value) => value === "" || ISO_DATE.test(value),
        "Enter a valid date."
      )
      .optional(),
    recurrence: z.enum(RECURRENCE_VALUES),
  })
  // Backs the client_tasks_recur_needs_due check constraint: a repeating task
  // needs an anchor date to roll forward from.
  .refine((data) => data.recurrence === "none" || Boolean(data.due_date), {
    path: ["due_date"],
    message: "A repeating task needs a due date to roll forward from.",
  });

export type TaskFormValues = z.infer<typeof taskFormSchema>;

export type TaskFormState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
} | null;

// Field -> messages map from a Zod error (reads error.issues directly, the same
// helper shape the sites form uses).
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
