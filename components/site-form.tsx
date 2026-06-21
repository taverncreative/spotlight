"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormField, fieldInputClass } from "@/components/form-field";
import type { FormState } from "@/lib/form-state";

type SiteValues = {
  name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  town?: string | null;
  county?: string | null;
  postcode?: string | null;
  access_notes?: string | null;
};

// One compact form for adding a site and for editing one inline, the same
// pattern as the contact form.
export function SiteForm({
  action,
  idPrefix,
  ariaLabel,
  submitLabel,
  initial = {},
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  idPrefix: string;
  ariaLabel: string;
  submitLabel: string;
  initial?: SiteValues;
  cancelHref?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const id = (suffix: string) => `${idPrefix}-${suffix}`;

  return (
    <form
      action={formAction}
      aria-label={ariaLabel}
      className="space-y-3 rounded-md border p-4"
    >
      {state?.formError ? (
        <p role="alert" className="text-sm text-destructive">
          {state.formError}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormField label="Name" name={id("name")} errors={state?.fieldErrors?.name}>
            <input
              id={id("name")}
              name="name"
              defaultValue={initial.name ?? ""}
              className={fieldInputClass}
            />
          </FormField>
        </div>
        <FormField
          label="Address line 1"
          name={id("address1")}
          errors={state?.fieldErrors?.address_line1}
        >
          <input
            id={id("address1")}
            name="address_line1"
            defaultValue={initial.address_line1 ?? ""}
            className={fieldInputClass}
          />
        </FormField>
        <FormField
          label="Address line 2"
          name={id("address2")}
          errors={state?.fieldErrors?.address_line2}
        >
          <input
            id={id("address2")}
            name="address_line2"
            defaultValue={initial.address_line2 ?? ""}
            className={fieldInputClass}
          />
        </FormField>
        <FormField label="Town" name={id("town")} errors={state?.fieldErrors?.town}>
          <input
            id={id("town")}
            name="town"
            defaultValue={initial.town ?? ""}
            className={fieldInputClass}
          />
        </FormField>
        <FormField
          label="County"
          name={id("county")}
          errors={state?.fieldErrors?.county}
        >
          <input
            id={id("county")}
            name="county"
            defaultValue={initial.county ?? ""}
            className={fieldInputClass}
          />
        </FormField>
        <FormField
          label="Postcode"
          name={id("postcode")}
          errors={state?.fieldErrors?.postcode}
        >
          <input
            id={id("postcode")}
            name="postcode"
            defaultValue={initial.postcode ?? ""}
            className={fieldInputClass}
          />
        </FormField>
        <div className="sm:col-span-2">
          <FormField
            label="Access notes"
            name={id("access-notes")}
            errors={state?.fieldErrors?.access_notes}
          >
            <textarea
              id={id("access-notes")}
              name="access_notes"
              rows={2}
              defaultValue={initial.access_notes ?? ""}
              className={fieldInputClass}
            />
          </FormField>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving" : submitLabel}
        </Button>
        {cancelHref ? (
          <Link
            href={cancelHref}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Cancel
          </Link>
        ) : null}
      </div>
    </form>
  );
}
