"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/form-state";

// Restore control for the deleted-record views, shared by the modules.
export function RestoreRecordButton({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-1">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Restoring" : "Restore"}
      </Button>
      {state?.formError ? (
        <p role="alert" className="text-sm text-destructive">
          {state.formError}
        </p>
      ) : null}
    </form>
  );
}
