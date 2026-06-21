"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, fieldInputClass } from "@/components/form-field";
import type { FormState } from "@/lib/form-state";

export type CustomerOption = { id: string; name: string };
export type SiteOption = { id: string; name: string };

// The quote header: title, customer, valid-until and the optional site, saved
// via updateQuote. The site select offers the current customer's active sites
// plus a "no site" option.
export function QuoteHeaderForm({
  action,
  customers,
  sites,
  initial,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  customers: CustomerOption[];
  sites: SiteOption[];
  initial: {
    title: string | null;
    customer_id: string;
    valid_until: string | null;
    site_id: string | null;
  };
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form
      action={formAction}
      aria-label="Quote header"
      className="max-w-lg space-y-4"
    >
      {state?.formError ? (
        <p role="alert" className="text-sm text-destructive">
          {state.formError}
        </p>
      ) : null}

      <FormField label="Title" name="title" errors={state?.fieldErrors?.title}>
        <input
          id="title"
          name="title"
          defaultValue={initial.title ?? ""}
          className={fieldInputClass}
        />
      </FormField>

      <FormField
        label="Customer"
        name="customer_id"
        errors={state?.fieldErrors?.customer_id}
      >
        <select
          id="customer_id"
          name="customer_id"
          defaultValue={initial.customer_id}
          className={fieldInputClass}
        >
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
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
          defaultValue={initial.valid_until ?? ""}
          className={fieldInputClass}
        />
      </FormField>

      <FormField
        label="Site"
        name="site_id"
        errors={state?.fieldErrors?.site_id}
      >
        <select
          id="site_id"
          name="site_id"
          defaultValue={initial.site_id ?? ""}
          className={fieldInputClass}
        >
          <option value="">No site</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
      </FormField>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving" : "Save header"}
      </Button>
    </form>
  );
}
