"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/form-state";

// One lifecycle move as a button (Accepted, Declined, Expired, Back to
// draft). Errors from the action show beneath it.
export function TransitionButton({
  action,
  label,
  variant = "outline",
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  label: string;
  variant?: "default" | "outline" | "destructive";
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <div className="space-y-1">
      <form action={formAction}>
        <Button type="submit" variant={variant} size="sm" disabled={pending}>
          {pending ? "Working" : label}
        </Button>
      </form>
      {state?.formError ? (
        <p role="alert" className="text-sm text-destructive">
          {state.formError}
        </p>
      ) : null}
    </div>
  );
}
