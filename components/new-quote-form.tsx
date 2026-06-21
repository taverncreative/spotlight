"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, fieldInputClass } from "@/components/form-field";
import type { CustomerOption } from "@/components/quote-header-form";
import type { FormState } from "@/lib/form-state";

export function NewQuoteForm({
  action,
  customers,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  customers: CustomerOption[];
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      {state?.formError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.formError}
        </p>
      ) : null}

      <FormField
        label="Customer"
        name="customer_id"
        errors={state?.fieldErrors?.customer_id}
      >
        <select id="customer_id" name="customer_id" className={fieldInputClass}>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Title" name="title" errors={state?.fieldErrors?.title}>
        <input
          id="title"
          name="title"
          defaultValue=""
          className={fieldInputClass}
        />
      </FormField>

      <FormField
        label="Valid until"
        name="valid_until"
        errors={state?.fieldErrors?.valid_until}
      >
        <input
          id="valid_until"
          name="valid_until"
          type="date"
          className={fieldInputClass}
        />
      </FormField>

      <Button type="submit" disabled={pending}>
        {pending ? "Creating" : "Create quote"}
      </Button>
    </form>
  );
}
