"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/form-state";

// The quick status control on each job row and on the detail. It offers the
// sensible forward moves from the current status plus cancel; scheduling (which
// sets a time) is done through the schedule control or the edit form, so an
// unscheduled job only offers cancel here. completed and cancelled are terminal
// in this control (a correction goes through the edit form, since setJobStatus
// itself allows any status). Each move is its own small form sharing one action,
// which revalidates the screen in place.
const TRANSITIONS: Record<string, Array<{ status: string; label: string }>> = {
  unscheduled: [{ status: "cancelled", label: "Cancel" }],
  scheduled: [
    { status: "in_progress", label: "Start" },
    { status: "cancelled", label: "Cancel" },
  ],
  in_progress: [
    { status: "completed", label: "Complete" },
    { status: "cancelled", label: "Cancel" },
  ],
  completed: [],
  cancelled: [],
};

export function JobStatusControl({
  action,
  status,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  status: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const options = TRANSITIONS[status] ?? [];

  if (options.length === 0) {
    return null;
  }

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
