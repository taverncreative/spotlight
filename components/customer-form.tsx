"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, fieldInputClass } from "@/components/form-field";
import { CUSTOMER_TYPES } from "@/lib/customers/schemas";
import type { FormState } from "@/lib/form-state";

type CustomerFormValues = {
  name?: string | null;
  type?: string;
  email?: string | null;
  phone?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  town?: string | null;
  county?: string | null;
  postcode?: string | null;
};

// One form for create and edit, following the lead form pattern.
export function CustomerForm({
  action,
  initial = {},
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  initial?: CustomerFormValues;
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

      <FormField label="Type" name="type" errors={state?.fieldErrors?.type}>
        <select
          id="type"
          name="type"
          defaultValue={initial.type ?? "business"}
          className={fieldInputClass}
        >
          {CUSTOMER_TYPES.map((value) => (
            <option key={value} value={value}>
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </option>
          ))}
        </select>
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
        label="Address line 1"
        name="address_line1"
        errors={state?.fieldErrors?.address_line1}
      >
        <input
          id="address_line1"
          name="address_line1"
          defaultValue={initial.address_line1 ?? ""}
          className={fieldInputClass}
        />
      </FormField>

      <FormField
        label="Address line 2"
        name="address_line2"
        errors={state?.fieldErrors?.address_line2}
      >
        <input
          id="address_line2"
          name="address_line2"
          defaultValue={initial.address_line2 ?? ""}
          className={fieldInputClass}
        />
      </FormField>

      <FormField label="Town" name="town" errors={state?.fieldErrors?.town}>
        <input
          id="town"
          name="town"
          defaultValue={initial.town ?? ""}
          className={fieldInputClass}
        />
      </FormField>

      <FormField
        label="County"
        name="county"
        errors={state?.fieldErrors?.county}
      >
        <input
          id="county"
          name="county"
          defaultValue={initial.county ?? ""}
          className={fieldInputClass}
        />
      </FormField>

      <FormField
        label="Postcode"
        name="postcode"
        errors={state?.fieldErrors?.postcode}
      >
        <input
          id="postcode"
          name="postcode"
          defaultValue={initial.postcode ?? ""}
          className={fieldInputClass}
        />
      </FormField>

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
