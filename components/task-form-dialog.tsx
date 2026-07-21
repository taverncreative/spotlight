"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { fieldInputClass } from "@/components/form-field";
import { createTask, updateTask } from "@/lib/tasks/actions";
import { type TaskFormState } from "@/lib/tasks/schemas";
import { RECURRENCE_OPTIONS } from "@/lib/tasks/recurrence";

export type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  status: string;
  recurrence: string;
  created_at: string;
};

// Add/edit task modal. task === null is the add case (uses clientId); otherwise
// pre-filled for editing. Mount under a changing key so each open is fresh.
export function TaskFormDialog({
  open,
  onOpenChange,
  clientId,
  task,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  task: TaskRow | null;
}) {
  const router = useRouter();
  const isEdit = task !== null;
  const action = isEdit ? updateTask : createTask;
  const [state, formAction, pending] = useActionState<TaskFormState, FormData>(
    action,
    null
  );

  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [recurrence, setRecurrence] = useState(task?.recurrence ?? "none");

  useEffect(() => {
    if (state?.ok) {
      onOpenChange(false);
      router.refresh();
    }
  }, [state, onOpenChange, router]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="space-y-1">
          <DialogTitle>{isEdit ? "Edit task" : "Add task"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this task's details."
              : "Add an operational task for this client."}
          </DialogDescription>
        </div>
        <form action={formAction} className="space-y-4">
          {task ? (
            <input type="hidden" name="id" value={task.id} />
          ) : (
            <input type="hidden" name="client_id" value={clientId} />
          )}

          <div className="space-y-1.5">
            <label htmlFor="task-title" className="text-sm font-medium">
              Title
            </label>
            <input
              id="task-title"
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
              required
              placeholder="e.g. Update review schema"
              className={fieldInputClass}
            />
            {state?.fieldErrors?.title ? (
              <p className="text-sm text-destructive">
                {state.fieldErrors.title[0]}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="task-notes" className="text-sm font-medium">
              Notes <span className="text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="task-notes"
              name="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              className={fieldInputClass}
            />
            {state?.fieldErrors?.notes ? (
              <p className="text-sm text-destructive">
                {state.fieldErrors.notes[0]}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="task-due" className="text-sm font-medium">
                Due date
              </label>
              <input
                id="task-due"
                name="due_date"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className={fieldInputClass}
              />
              {state?.fieldErrors?.due_date ? (
                <p className="text-sm text-destructive">
                  {state.fieldErrors.due_date[0]}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="task-recurrence" className="text-sm font-medium">
                Repeat
              </label>
              <select
                id="task-recurrence"
                name="recurrence"
                value={recurrence}
                onChange={(event) => setRecurrence(event.target.value)}
                className={fieldInputClass}
              >
                {RECURRENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {recurrence !== "none" ? (
            <p className="text-xs text-muted-foreground">
              Completing a repeating task rolls its due date forward to the next
              occurrence instead of closing it.
            </p>
          ) : null}

          {state?.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
