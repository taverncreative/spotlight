"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, fieldInputClass } from "@/components/form-field";
import { LEAD_STATUSES } from "@/lib/leads/schemas";
import type { FormState } from "@/lib/form-state";

type LeadFormValues = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  message?: string | null;
  source?: string | null;
  status?: string;
};

// One form for create and edit. Edit passes initial values and showStatus;
// create leaves status to its database default of new.
export function LeadForm({
  action,
  initial = {},
  showStatus = false,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  initial?: LeadFormValues;
  showStatus?: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-5">
      {state?.formError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.formError}
        </p>
      ) : null}

      <FormField label="Name" name="name" errors={state?.fieldErrors?.name}>
        <input
          id="name"
          name="name"
          defaultValue={initial.name ?? ""}
          className={fieldInputClass}
        />
      </FormField>

      <FormField label="Email" name="email" errors={state?.fieldErrors?.email}>
        <input
          id="email"
          name="email"
          type="email"
          defaultValue={initial.email ?? ""}
          className={fieldInputClass}
        />
      </FormField>

      <FormField label="Phone" name="phone" errors={state?.fieldErrors?.phone}>
        <input
          id="phone"
          name="phone"
          defaultValue={initial.phone ?? ""}
          className={fieldInputClass}
        />
      </FormField>

      <FormField
        label="Message"
        name="message"
        errors={state?.fieldErrors?.message}
      >
        <textarea
          id="message"
          name="message"
          rows={4}
          defaultValue={initial.message ?? ""}
          className={fieldInputClass}
        />
      </FormField>

      <FormField
        label="Source"
        name="source"
        errors={state?.fieldErrors?.source}
      >
        <input
          id="source"
          name="source"
          defaultValue={initial.source ?? ""}
          className={fieldInputClass}
        />
      </FormField>

      {showStatus ? (
        <FormField
          label="Status"
          name="status"
          errors={state?.fieldErrors?.status}
        >
          <select
            id="status"
            name="status"
            defaultValue={initial.status ?? "new"}
            className={fieldInputClass}
          >
            {LEAD_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </FormField>
      ) : null}

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
