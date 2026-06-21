"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { fieldInputClass } from "@/components/form-field";
import type { FormState } from "@/lib/form-state";

export type LineItem = {
  id: string;
  position: number;
  description: string;
  quantity: number;
  unit_price_pence: number;
  vat_rate: number;
  line_total_pence: number;
};

// The single row currently in edit mode: the pre-filled form with Save and
// Cancel. Saving redirects back to the builder without the editLine param,
// which is what returns the row to display mode; Cancel is a plain link to
// the same place.
export function LineItemRow({
  line,
  saveAction,
  cancelHref,
}: {
  line: LineItem;
  saveAction: (state: FormState, formData: FormData) => Promise<FormState>;
  cancelHref: string;
}) {
  const [saveState, saveFormAction, savePending] = useActionState(
    saveAction,
    null
  );
  const fieldId = (suffix: string) => `line-${line.position}-${suffix}`;

  return (
    <div className="space-y-2 rounded-lg border border-brand/40 bg-muted/30 p-4">
      <form
        action={saveFormAction}
        aria-label={`Line ${line.position}`}
        className="grid grid-cols-1 gap-3 sm:grid-cols-5"
      >
        <div className="sm:col-span-2">
          <label
            htmlFor={fieldId("description")}
            className="text-xs font-medium text-muted-foreground"
          >
            Description
          </label>
          <input
            id={fieldId("description")}
            name="description"
            defaultValue={line.description}
            className={fieldInputClass}
          />
        </div>
        <div>
          <label
            htmlFor={fieldId("quantity")}
            className="text-xs font-medium text-muted-foreground"
          >
            Quantity
          </label>
          <input
            id={fieldId("quantity")}
            name="quantity"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={Number(line.quantity).toFixed(2)}
            className={fieldInputClass}
          />
        </div>
        <div>
          <label
            htmlFor={fieldId("unit-price")}
            className="text-xs font-medium text-muted-foreground"
          >
            Unit price (£)
          </label>
          <input
            id={fieldId("unit-price")}
            name="unit_price_pounds"
            inputMode="decimal"
            defaultValue={(line.unit_price_pence / 100).toFixed(2)}
            className={fieldInputClass}
          />
        </div>
        <div>
          <label
            htmlFor={fieldId("vat-rate")}
            className="text-xs font-medium text-muted-foreground"
          >
            VAT rate (%)
          </label>
          <input
            id={fieldId("vat-rate")}
            name="vat_rate"
            type="number"
            step="0.01"
            min="0"
            max="100"
            defaultValue={Number(line.vat_rate)}
            className={fieldInputClass}
          />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" size="sm" disabled={savePending}>
            {savePending ? "Saving" : "Save"}
          </Button>
          <Link
            href={cancelHref}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Cancel
          </Link>
        </div>
      </form>
      {saveState?.formError ? (
        <p role="alert" className="text-sm text-destructive">
          {saveState.formError}
        </p>
      ) : null}
      {saveState?.fieldErrors ? (
        <p role="alert" className="text-sm text-destructive">
          {Object.values(saveState.fieldErrors).flat()[0]}
        </p>
      ) : null}
    </div>
  );
}
