"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormField, fieldInputClass } from "@/components/form-field";
import type { FormState } from "@/lib/form-state";

// A small body-only form for adding a note and for editing one inline, the same
// shape as the task and contact forms. idPrefix keeps the field id unique when
// the add form and an inline edit form are on the page at once; cancelHref
// renders a Cancel link back to display mode (edit only).
export function NoteForm({
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
  initial?: { body?: string | null };
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
      <FormField label="Note" name={id("body")} errors={state?.fieldErrors?.body}>
        <textarea
          id={id("body")}
          name="body"
          rows={3}
          defaultValue={initial.body ?? ""}
          className={fieldInputClass}
        />
      </FormField>
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
