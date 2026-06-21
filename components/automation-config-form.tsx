"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, fieldInputClass } from "@/components/form-field";
import type { AutomationOption } from "@/lib/automations/catalogue";
import type { FormState } from "@/lib/form-state";

type Member = { id: string; name: string };

// The settings form for one automation (Pass 10C), built generically from the
// catalogue's declared options so it follows the catalogue rather than hard
// coding a type's fields: text is a text input, integer a number input within
// its bounds, member a picker of the workspace's active members (optional ones
// offer Unassigned). The field ids are prefixed with the automation key so two
// automations' forms never collide; the name attributes stay the canonical option
// keys, which the form-action reads. Validation lives in the action.
export function AutomationConfigForm({
  action,
  idPrefix,
  options,
  config,
  members,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  idPrefix: string;
  options: AutomationOption[];
  config: Record<string, unknown>;
  members: Member[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const fieldId = (key: string) => `${idPrefix}-${key}`;

  return (
    <form action={formAction} aria-label="Configure automation" className="max-w-md space-y-4">
      {options.map((option) => {
        const current = config[option.key];
        const errors = state?.fieldErrors?.[option.key];

        if (option.kind === "member") {
          return (
            <FormField key={option.key} label={option.label} name={fieldId(option.key)} errors={errors}>
              <select
                id={fieldId(option.key)}
                name={option.key}
                defaultValue={typeof current === "string" ? current : ""}
                className={fieldInputClass}
              >
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </FormField>
          );
        }

        if (option.kind === "integer") {
          return (
            <FormField key={option.key} label={option.label} name={fieldId(option.key)} errors={errors}>
              <input
                id={fieldId(option.key)}
                name={option.key}
                type="number"
                min={option.min}
                max={option.max}
                defaultValue={typeof current === "number" ? current : ""}
                className={fieldInputClass}
              />
            </FormField>
          );
        }

        return (
          <FormField key={option.key} label={option.label} name={fieldId(option.key)} errors={errors}>
            <input
              id={fieldId(option.key)}
              name={option.key}
              maxLength={option.maxLength}
              defaultValue={typeof current === "string" ? current : ""}
              className={fieldInputClass}
            />
          </FormField>
        );
      })}

      {state?.formError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.formError}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving" : "Save settings"}
      </Button>
    </form>
  );
}
