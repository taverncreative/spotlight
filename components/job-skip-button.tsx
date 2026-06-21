"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/form-state";

// Skip a single recurring occurrence: cancels and detaches it in place. Skipping
// is the per-occurrence "this one will not happen", distinct from deleting the
// row; the occurrence stays visible as cancelled and survives series changes.
export function JobSkipButton({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-1">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Skipping" : "Skip this occurrence"}
      </Button>
      {state?.formError ? (
        <p role="alert" className="text-sm text-destructive">
          {state.formError}
        </p>
      ) : null}
    </form>
  );
}
