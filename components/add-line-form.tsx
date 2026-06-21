"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, fieldInputClass } from "@/components/form-field";
import type { FormState } from "@/lib/form-state";

// Appends a line to the quote. Prices are entered in pounds; the server
// converts to pence. The database recomputes the quote totals.
export function AddLineForm({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form
      action={formAction}
      aria-label="Add line item"
      className="space-y-4 rounded-lg bg-muted/40 p-4"
    >
      <p className="text-sm font-medium">Add line item</p>
      {state?.formError ? (
        <p role="alert" className="text-sm text-destructive">
          {state.formError}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="sm:col-span-4">
          <FormField
            label="Description"
            name="add-description"
            errors={state?.fieldErrors?.description}
          >
            <input
              id="add-description"
              name="description"
              className={fieldInputClass}
            />
          </FormField>
        </div>
        <FormField
          label="Quantity"
          name="add-quantity"
          errors={state?.fieldErrors?.quantity}
        >
          <input
            id="add-quantity"
            name="quantity"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue="1.00"
            className={fieldInputClass}
          />
        </FormField>
        <FormField
          label="Unit price (£)"
          name="add-unit-price"
          errors={state?.fieldErrors?.unit_price_pounds}
        >
          <input
            id="add-unit-price"
            name="unit_price_pounds"
            inputMode="decimal"
            className={fieldInputClass}
          />
        </FormField>
        <FormField
          label="VAT rate (%)"
          name="add-vat-rate"
          errors={state?.fieldErrors?.vat_rate}
        >
          <input
            id="add-vat-rate"
            name="vat_rate"
            type="number"
            step="0.01"
            min="0"
            max="100"
            defaultValue="20"
            className={fieldInputClass}
          />
        </FormField>
        <div className="flex items-end">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving" : "Save line"}
          </Button>
        </div>
      </div>
    </form>
  );
}
