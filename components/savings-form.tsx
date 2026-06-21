"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormField, fieldInputClass } from "@/components/form-field";
import { SAVINGS_CADENCES } from "@/lib/savings/schemas";
import type { FormState } from "@/lib/form-state";

// One form for add and edit. The amount is entered in pounds (the form-action
// converts it to pence on the way to the action); cadence is monthly or annual;
// note and cancelled-on date are optional. Inputs are uncontrolled with
// defaultValue, since there is no live preview to drive (unlike the templates
// form). Field errors and the pending state come from useActionState.

const CADENCE_LABELS: Record<(typeof SAVINGS_CADENCES)[number], string> = {
  monthly: "Monthly",
  annual: "Annual",
};

type SavingsFormValues = {
  label?: string | null;
  // The amount pre-filled in pounds for editing (the stored pence converted).
  amount?: string | null;
  cadence?: string | null;
  note?: string | null;
  cancelled_on?: string | null;
};

export function SavingsForm({
  action,
  ariaLabel,
  submitLabel,
  initial = {},
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  ariaLabel: string;
  submitLabel: string;
  initial?: SavingsFormValues;
  cancelHref?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} aria-label={ariaLabel} className="space-y-5">
      {state?.formError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.formError}
        </p>
      ) : null}

      <FormField label="Label" name="label" errors={state?.fieldErrors?.label}>
        <input
          id="label"
          name="label"
          defaultValue={initial.label ?? ""}
          className={fieldInputClass}
          placeholder="What was cancelled, for example Old CRM"
        />
      </FormField>

      <FormField
        label="Amount in pounds"
        name="amount"
        errors={state?.fieldErrors?.amount}
      >
        <input
          id="amount"
          name="amount"
          inputMode="decimal"
          defaultValue={initial.amount ?? ""}
          className={fieldInputClass}
          placeholder="9.99"
        />
      </FormField>

      <FormField
        label="Cadence"
        name="cadence"
        errors={state?.fieldErrors?.cadence}
      >
        <select
          id="cadence"
          name="cadence"
          defaultValue={initial.cadence ?? "monthly"}
          className={fieldInputClass}
        >
          {SAVINGS_CADENCES.map((value) => (
            <option key={value} value={value}>
              {CADENCE_LABELS[value]}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Note" name="note" errors={state?.fieldErrors?.note}>
        <textarea
          id="note"
          name="note"
          rows={3}
          defaultValue={initial.note ?? ""}
          className={fieldInputClass}
          placeholder="Optional"
        />
      </FormField>

      <FormField
        label="Cancelled on"
        name="cancelled_on"
        errors={state?.fieldErrors?.cancelled_on}
      >
        <input
          id="cancelled_on"
          name="cancelled_on"
          type="date"
          defaultValue={initial.cancelled_on ?? ""}
          className={fieldInputClass}
        />
      </FormField>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : submitLabel}
        </Button>
        {cancelHref ? (
          <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
            Cancel
          </Link>
        ) : null}
      </div>
    </form>
  );
}
