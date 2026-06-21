"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/form-state";

// Enable or disable a form. The label follows the current status; the bound
// action already carries the target status. Disabling stops ingestion at the
// public endpoint (a submission to a disabled form's token 404s).
export function WebhookFormStatusButton({
  action,
  status,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  status: "active" | "disabled";
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const disabling = status === "active";

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <form action={formAction}>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending
            ? disabling
              ? "Disabling"
              : "Enabling"
            : disabling
              ? "Disable"
              : "Enable"}
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
