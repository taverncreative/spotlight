"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormField, fieldInputClass } from "@/components/form-field";
import { TASK_STATUSES } from "@/lib/tasks/schemas";
import type { FormState } from "@/lib/form-state";

type Member = { id: string; name: string };

type TaskFormValues = {
  title?: string | null;
  description?: string | null;
  due_at?: string | null;
  assigned_to?: string | null;
  status?: string;
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

// One form for create and edit. Create passes includeStatus and the members
// for the assignee picker; edit passes initial values and a cancel link.
// idPrefix keeps the field ids unique when an add form and an inline edit form
// are on the same page at once (the per-record TasksSection), the same device
// the contact and site forms use; the field name attributes stay canonical.
export function TaskForm({
  action,
  members,
  ariaLabel,
  submitLabel,
  initial = {},
  includeStatus = false,
  cancelHref,
  idPrefix = "task",
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  members: Member[];
  ariaLabel: string;
  submitLabel: string;
  initial?: TaskFormValues;
  includeStatus?: boolean;
  cancelHref?: string;
  idPrefix?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const id = (suffix: string) => `${idPrefix}-${suffix}`;
  // The stored due_at is an ISO datetime; a date input wants the day only.
  const dueValue = initial.due_at ? initial.due_at.slice(0, 10) : "";

  return (
    <form action={formAction} aria-label={ariaLabel} className="space-y-5">
      {state?.formError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.formError}
        </p>
      ) : null}

      <FormField label="Title" name={id("title")} errors={state?.fieldErrors?.title}>
        <input
          id={id("title")}
          name="title"
          defaultValue={initial.title ?? ""}
          className={fieldInputClass}
        />
      </FormField>

      <FormField
        label="Description"
        name={id("description")}
        errors={state?.fieldErrors?.description}
      >
        <textarea
          id={id("description")}
          name="description"
          rows={3}
          defaultValue={initial.description ?? ""}
          className={fieldInputClass}
        />
      </FormField>

      <FormField
        label="Due date"
        name={id("due_at")}
        errors={state?.fieldErrors?.due_at}
      >
        <input
          id={id("due_at")}
          name="due_at"
          type="date"
          defaultValue={dueValue}
          className={fieldInputClass}
        />
      </FormField>

      <FormField
        label="Assignee"
        name={id("assigned_to")}
        errors={state?.fieldErrors?.assigned_to}
      >
        <select
          id={id("assigned_to")}
          name="assigned_to"
          defaultValue={initial.assigned_to ?? ""}
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

      {includeStatus ? (
        <FormField
          label="Status"
          name={id("status")}
          errors={state?.fieldErrors?.status}
        >
          <select
            id={id("status")}
            name="status"
            defaultValue={initial.status ?? "open"}
            className={fieldInputClass}
          >
            {TASK_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </FormField>
      ) : null}

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : submitLabel}
        </Button>
        {cancelHref ? (
          <Link
            href={cancelHref}
            className={buttonVariants({ variant: "outline" })}
          >
            Cancel
          </Link>
        ) : null}
      </div>
    </form>
  );
}
