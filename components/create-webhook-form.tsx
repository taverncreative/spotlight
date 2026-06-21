"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, fieldInputClass } from "@/components/form-field";
import type { FormState } from "@/lib/form-state";

// Create a new lead-capture form. Shown only to client_admin; the action
// enforces the same gate server-side. On success the action redirects back to
// the forms list, which re-renders with the new form.
export function CreateWebhookForm({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-3 rounded-md border p-3"
    >
      <div className="min-w-60 grow">
        <FormField
          label="New form name"
          name="name"
          errors={state?.fieldErrors?.name}
        >
          <input
            id="name"
            name="name"
            className={fieldInputClass}
            placeholder="Contact page form"
            maxLength={100}
          />
        </FormField>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Creating" : "Create form"}
      </Button>
      {state?.formError ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {state.formError}
        </p>
      ) : null}
    </form>
  );
}
