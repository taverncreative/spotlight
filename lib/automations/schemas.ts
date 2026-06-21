import { z } from "zod";
import { AUTOMATION_KEYS, type AutomationOption } from "./catalogue";

// Automations action schemas (Pass 10A). automation_type must be a known
// catalogue key. The per-type config schema is derived from that type's declared
// options, so the catalogue stays the single source: add an option and its
// validation follows automatically.

const automationType = z
  .string()
  .refine((key) => AUTOMATION_KEYS.includes(key), {
    message: "Unknown automation type",
  });

export const setEnabledSchema = z.object({
  automation_type: automationType,
  enabled: z.boolean(),
});

// The raw config is any object; the type-specific shape is checked by
// buildConfigSchema once the automation type is known.
export const configInputSchema = z.object({
  automation_type: automationType,
  config: z.record(z.string(), z.unknown()).default({}),
});

// Builds the validation schema for one automation's config from its options.
// text -> trimmed string (non-empty when required); integer -> whole number
// within min/max; member -> a uuid (its membership is checked in the action).
// Optional options accept null or absence. Unknown config keys are rejected.
export function buildConfigSchema(options: AutomationOption[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const option of options) {
    let field: z.ZodTypeAny;
    if (option.kind === "integer") {
      let num = z.number().int();
      if (option.min !== undefined) num = num.min(option.min);
      if (option.max !== undefined) num = num.max(option.max);
      field = num;
    } else if (option.kind === "member") {
      field = z.uuid();
    } else {
      let str = z.string().trim();
      if (option.required) str = str.min(1, `${option.label} is required`);
      if (option.maxLength !== undefined) str = str.max(option.maxLength);
      field = str;
    }
    shape[option.key] = option.required ? field : field.nullish();
  }
  return z.strictObject(shape);
}
