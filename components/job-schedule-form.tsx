"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, fieldInputClass } from "@/components/form-field";
import type { FormState } from "@/lib/form-state";

type Member = { id: string; name: string };

// The focused schedule control on the job detail: set or change the start time
// and the assignee in one step (the scheduleJob action moves an unscheduled job
// to scheduled). The full edit form can also change these; this is the quick
// scheduler. Shown for write users while the job is not completed or cancelled.
export function JobScheduleForm({
  action,
  members,
  scheduledStart,
  assignedTo,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  members: Member[];
  scheduledStart: string | null;
  assignedTo: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const startValue = scheduledStart ? scheduledStart.slice(0, 16) : "";

  return (
    <form action={formAction} aria-label="Schedule job" className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Scheduled start"
          name="scheduled_start"
          errors={state?.fieldErrors?.scheduled_start}
        >
          <input
            id="scheduled_start"
            name="scheduled_start"
            type="datetime-local"
            defaultValue={startValue}
            required
            className={fieldInputClass}
          />
        </FormField>

        <FormField
          label="Assignee"
          name="assigned_to"
          errors={state?.fieldErrors?.assigned_to}
        >
          <select
            id="assigned_to"
            name="assigned_to"
            defaultValue={assignedTo ?? ""}
            className={fieldInputClass}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      {state?.formError ? (
        <p role="alert" className="text-sm text-destructive">
          {state.formError}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving" : "Save schedule"}
      </Button>
    </form>
  );
}
