"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/form-state";

// The enable/disable control for one automation (Pass 10C). The action is bound
// to the target state, so the button asks for the opposite of where it is now;
// the screen revalidates after, flipping the label and the state badge.
export function AutomationToggle({
  action,
  enabled,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  enabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <div className="space-y-1">
      <form action={formAction}>
        <Button
          type="submit"
          size="sm"
          variant={enabled ? "outline" : "default"}
          disabled={pending}
        >
          {pending
            ? enabled
              ? "Disabling"
              : "Enabling"
            : enabled
              ? "Disable"
              : "Enable"}
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
