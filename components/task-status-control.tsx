"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/form-state";

// The quick status control on each task row. Tasks have no strict lifecycle,
// so the offered moves are just the sensible ones from the current status:
// start, finish, cancel from the live statuses, and reopen from the ended
// ones. Each move is its own small form carrying the target status, sharing
// one action; the action revalidates the list in place.
const TRANSITIONS: Record<string, Array<{ status: string; label: string }>> = {
  open: [
    { status: "in_progress", label: "Start" },
    { status: "done", label: "Done" },
    { status: "cancelled", label: "Cancel" },
  ],
  in_progress: [
    { status: "done", label: "Done" },
    { status: "cancelled", label: "Cancel" },
  ],
  done: [{ status: "open", label: "Reopen" }],
  cancelled: [{ status: "open", label: "Reopen" }],
};

export function TaskStatusControl({
  action,
  status,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  status: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const options = TRANSITIONS[status] ?? [];

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <form key={option.status} action={formAction}>
            <input type="hidden" name="status" value={option.status} />
            <Button type="submit" variant="outline" size="sm" disabled={pending}>
              {option.label}
            </Button>
          </form>
        ))}
      </div>
      {state?.formError ? (
        <p role="alert" className="text-xs text-destructive">
          {state.formError}
        </p>
      ) : null}
    </div>
  );
}
