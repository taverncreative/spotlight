"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { completeTask } from "@/lib/tasks/actions";
import { type TaskFormState } from "@/lib/tasks/schemas";
import { recurrenceLabel } from "@/lib/tasks/recurrence";
import { cn } from "@/lib/utils";

export type DueTaskRow = {
  id: string;
  title: string;
  due_date: string | null;
  recurrence: string;
  clients: { name: string; slug: string } | null;
};

// Local calendar dates as YYYY-MM-DD strings. Both due_date and these are
// date-only, so a lexicographic compare is a chronological one.
function isoDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDate(iso: string): string {
  // Parse as a plain calendar date (UTC noon avoids any timezone roll-back).
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Inline complete/reschedule, reusing slice 1's task-id-based, RLS-scoped action
// unchanged. A recurring task rolls forward and stays open (re-bucketing on
// refresh); a one-off goes done and drops off this open-only list.
function CompleteButton({ task }: { task: DueTaskRow }) {
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

function DueCard({ task, overdue }: { task: DueTaskRow; overdue: boolean }) {
  const recurLabel = recurrenceLabel(task.recurrence);
  const client = task.clients;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-card border bg-card p-4">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {client ? (
            <Link
              href={`/c/${client.slug}/tasks`}
              className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {client.name}
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">
              Unknown client
            </span>
          )}
          {recurLabel ? <Badge variant="outline">{recurLabel}</Badge> : null}
        </div>
        <p className="text-sm font-medium">{task.title}</p>
        <p
          className={cn(
            "text-xs",
            overdue ? "font-medium text-destructive" : "text-muted-foreground"
          )}
        >
          {task.due_date
            ? `${overdue ? "Overdue · " : "Due "}${formatDate(task.due_date)}`
            : "No due date"}
        </p>
      </div>
      <CompleteButton task={task} />
    </li>
  );
}

// The urgency bands, in display order. Each task lands in exactly one; the query
// already ordered due-soonest-first, so each band stays sorted by taking rows in
// arrival order.
const GROUPS = [
  { key: "overdue", label: "Overdue" },
  { key: "week", label: "Due this week" },
  { key: "later", label: "Later" },
  { key: "undated", label: "No due date" },
] as const;

type GroupKey = (typeof GROUPS)[number]["key"];

export function DueTasks({ tasks }: { tasks: DueTaskRow[] }) {
  const now = new Date();
  const today = isoDate(now);
  const weekEnd = isoDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)
  );

  const byGroup: Record<GroupKey, DueTaskRow[]> = {
    overdue: [],
    week: [],
    later: [],
    undated: [],
  };
  for (const task of tasks) {
    if (task.due_date === null) byGroup.undated.push(task);
    else if (task.due_date < today) byGroup.overdue.push(task);
    else if (task.due_date <= weekEnd) byGroup.week.push(task);
    else byGroup.later.push(task);
  }

  if (tasks.length === 0) {
    return (
      <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
        Nothing due. Every client is on top of it.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {GROUPS.map((group) => {
        const rows = byGroup[group.key];
        if (rows.length === 0) return null;
        return (
          <section key={group.key} className="space-y-2">
            <h2
              className={cn(
                "text-sm font-medium",
                group.key === "overdue"
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {group.label}
              <span className="ml-1.5 tabular-nums text-muted-foreground">
                {rows.length}
              </span>
            </h2>
            <ul className="grid gap-2">
              {rows.map((task) => (
                <DueCard
                  key={task.id}
                  task={task}
                  overdue={group.key === "overdue"}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
