"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormField, fieldInputClass } from "@/components/form-field";
import type { FormState } from "@/lib/form-state";

type ContactValues = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  job_title?: string | null;
};

// One compact form for adding a contact and for editing one inline, following
// the customer-form pattern. idPrefix keeps the field ids unique when an edit
// form and the add form are on the page at once; cancelHref renders a Cancel
// link back to display mode (edit only).
export function ContactForm({
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
  initial?: ContactValues;
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
        <FormField label="Name" name={id("name")} errors={state?.fieldErrors?.name}>
          <input
            id={id("name")}
            name="name"
            defaultValue={initial.name ?? ""}
            className={fieldInputClass}
          />
        </FormField>
        <FormField
          label="Job title"
          name={id("job-title")}
          errors={state?.fieldErrors?.job_title}
        >
          <input
            id={id("job-title")}
            name="job_title"
            defaultValue={initial.job_title ?? ""}
            className={fieldInputClass}
          />
        </FormField>
        <FormField
          label="Email"
          name={id("email")}
          errors={state?.fieldErrors?.email}
        >
          <input
            id={id("email")}
            name="email"
            type="email"
            defaultValue={initial.email ?? ""}
            className={fieldInputClass}
          />
        </FormField>
        <FormField
          label="Phone"
          name={id("phone")}
          errors={state?.fieldErrors?.phone}
        >
          <input
            id={id("phone")}
            name="phone"
            defaultValue={initial.phone ?? ""}
            className={fieldInputClass}
          />
        </FormField>
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
