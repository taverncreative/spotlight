"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/form-state";

// Promotes a contact to primary. The action clears is_primary on the
// customer's other contacts in the same operation, so the primary badge moves.
export function SetPrimaryButton({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <form action={formAction}>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "Setting" : "Set primary"}
        </Button>
      </form>
      {state?.formError ? (
        <span role="alert" className="text-xs text-destructive">
          {state.formError}
        </span>
      ) : null}
    </span>
  );
}
