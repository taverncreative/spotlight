"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TaskFormDialog, type TaskRow } from "@/components/task-form-dialog";
import { completeTask, deleteTask } from "@/lib/tasks/actions";
import { type TaskFormState } from "@/lib/tasks/schemas";
import { recurrenceLabel } from "@/lib/tasks/recurrence";
import { cn } from "@/lib/utils";

// Today as a YYYY-MM-DD string in the operator's local time, for comparing
// against a due_date (both are date-only, so a lexicographic compare is a
// chronological one).
function todayIso(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function formatDate(iso: string): string {
  // Parse as a plain calendar date (UTC noon avoids any timezone roll-back).
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Per-row complete action. Recurring tasks roll forward; 'none' tasks close.
function CompleteButton({ task }: { task: TaskRow }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<TaskFormState, FormData>(
    completeTask,
    null
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  const label =
    task.recurrence === "none" ? "Complete" : "Mark done · reschedule";

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={task.id} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Saving…" : label}
      </Button>
    </form>
  );
}

// Per-row delete with a confirm dialog, calling the action inside a transition
// (the post-delete pattern): success closes and refreshes, failure shows inline.
function DeleteButton({ task }: { task: TaskRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmDelete() {
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("id", task.id);
        const result = await deleteTask(null, formData);
        if (result?.ok) {
          setOpen(false);
          router.refresh();
        } else {
          setError(result?.error ?? "Could not delete the task.");
        }
      } catch {
        setError("Could not delete the task.");
      }
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Delete
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent size="sm">
          <div className="space-y-2">
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes “{task.title}”. This cannot be undone.
            </AlertDialogDescription>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={pending}
            >
              {pending ? "Deleting" : "Delete"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TaskCard({
  task,
  today,
  onEdit,
}: {
  task: TaskRow;
  today: string;
  onEdit: (task: TaskRow) => void;
}) {
  const isDone = task.status === "done";
  const isOverdue = !isDone && task.due_date !== null && task.due_date < today;
  const recurLabel = recurrenceLabel(task.recurrence);

  return (
    <li className="space-y-2 rounded-card border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "text-sm font-medium",
            isDone && "text-muted-foreground line-through"
          )}
        >
          {task.title}
        </span>
        {recurLabel ? <Badge variant="outline">{recurLabel}</Badge> : null}
        {isDone ? <Badge variant="secondary">Done</Badge> : null}
      </div>

      {task.notes ? (
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">
          {task.notes}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className={cn(
            "text-xs",
            isOverdue ? "font-medium text-destructive" : "text-muted-foreground"
          )}
        >
          {task.due_date
            ? `${isOverdue ? "Overdue · " : "Due "}${formatDate(task.due_date)}`
            : "No due date"}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {!isDone ? <CompleteButton task={task} /> : null}
          <Button variant="ghost" size="sm" onClick={() => onEdit(task)}>
            Edit
          </Button>
          <DeleteButton task={task} />
        </div>
      </div>
    </li>
  );
}

// The Tasks module: due-soonest-first list of open tasks, a muted Done section
// below, plus add/edit/complete/delete. The server page orders by due_date so
// the open list is already soonest-first; this splits open from done and hosts
// the shared add/edit dialog.
export function TasksList({
  clientId,
  tasks,
}: {
  clientId: string;
  tasks: TaskRow[];
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [formKey, setFormKey] = useState(0);
  const today = todayIso();

  function openAdd() {
    setEditing(null);
    setFormKey((key) => key + 1);
    setFormOpen(true);
  }
  function openEdit(task: TaskRow) {
    setEditing(task);
    setFormKey((key) => key + 1);
    setFormOpen(true);
  }

  const openTasks = tasks.filter((task) => task.status !== "done");
  const doneTasks = tasks.filter((task) => task.status === "done");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          {openTasks.length > 0 ? `${openTasks.length} open` : "Nothing due"}
        </h2>
        <Button onClick={openAdd} size="sm">
          Add task
        </Button>
      </div>

      {tasks.length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          No tasks yet. Add one to track what needs doing for this client.
        </p>
      ) : (
        <>
          {openTasks.length > 0 ? (
            <ul className="grid gap-2">
              {openTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  today={today}
                  onEdit={openEdit}
                />
              ))}
            </ul>
          ) : (
            <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
              All caught up. Nothing open for this client.
            </p>
          )}

          {doneTasks.length > 0 ? (
            <div className="space-y-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                Done
              </h2>
              <ul className="grid gap-2">
                {doneTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    today={today}
                    onEdit={openEdit}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      <TaskFormDialog
        key={`form-${formKey}`}
        open={formOpen}
        onOpenChange={setFormOpen}
        clientId={clientId}
        task={editing}
      />
    </div>
  );
}
