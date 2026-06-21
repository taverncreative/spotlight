import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { TaskForm } from "@/components/task-form";
import { TaskStatusControl } from "@/components/task-status-control";
import { TaskDeleteDialog } from "@/components/task-delete-dialog";
import { SectionCard, sectionRowClass } from "@/components/section-card";
import { hasPermission, isModuleEnabled } from "@/lib/authorisation";
import { requireWorkspaceAccess } from "@/lib/workspace";
import type { RELATED_TYPES } from "@/lib/tasks/schemas";
import { listOrganisationMembers } from "@/lib/members";
import { listTasks } from "@/app/app/[orgSlug]/tasks/actions";
import {
  createLinkedTaskFormAction,
  deleteLinkedTaskFormAction,
  setLinkedTaskStatusFormAction,
  updateLinkedTaskFormAction,
} from "@/app/app/[orgSlug]/tasks/form-actions";

// The per-record tasks section (Pass 6D), shared by the lead, customer and
// quote detail pages. It lists the record's own tasks (filtered by the
// polymorphic related pair) and, for write-capable roles, adds tasks already
// linked to this record, plus edit, the quick status control and delete. The
// section reuses the existing task form and controls; read_only sees the list
// only. It renders nothing when the tasks module is not enabled, so a record
// whose workspace lacks tasks simply shows no section.

type RelatedType = (typeof RELATED_TYPES)[number];

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  due_at: string | null;
  assigned_to: string | null;
  isOverdue: boolean;
};

const STATUS_BADGES: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  open: "default",
  in_progress: "secondary",
  done: "outline",
  cancelled: "destructive",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export async function TasksSection({
  orgSlug,
  recordType,
  recordId,
  detailHref,
  editTaskId,
}: {
  orgSlug: string;
  recordType: RelatedType;
  recordId: string;
  detailHref: string;
  editTaskId?: string;
}) {
  const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
  if (!(await isModuleEnabled(organisation, "tasks"))) return null;
  const canWrite = hasPermission(membership, "record.write");

  const members = await listOrganisationMembers(orgSlug);
  const tasks = (await listTasks(orgSlug, {
    related_type: recordType,
    related_id: recordId,
  })) as Task[];
  const nameById = new Map(members.map((m) => [m.id, m.name]));

  return (
    <SectionCard title="Tasks">
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks yet.</p>
      ) : (
        <ul className="space-y-3">
          {tasks.map((task) => (
            <li key={task.id}>
              {canWrite && editTaskId === task.id ? (
                <TaskForm
                  idPrefix="edit-task"
                  action={updateLinkedTaskFormAction.bind(
                    null,
                    orgSlug,
                    task.id,
                    detailHref
                  )}
                  members={members}
                  ariaLabel="Edit task"
                  submitLabel="Save"
                  initial={task}
                  cancelHref={detailHref}
                />
              ) : (
                <div className={sectionRowClass}>
                  <div className="space-y-1 text-sm">
                    <p className="font-medium">{task.title}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={STATUS_BADGES[task.status] ?? "secondary"}>
                        {STATUS_LABELS[task.status] ?? task.status}
                      </Badge>
                      {task.due_at ? (
                        <span
                          className={
                            task.isOverdue
                              ? "font-medium text-destructive"
                              : "text-muted-foreground"
                          }
                        >
                          {formatDate(task.due_at)}
                          {task.isOverdue ? " (overdue)" : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">No date</span>
                      )}
                      <span className="text-muted-foreground">
                        {task.assigned_to
                          ? nameById.get(task.assigned_to) ?? "Unknown"
                          : "Unassigned"}
                      </span>
                    </div>
                  </div>
                  {canWrite ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <TaskStatusControl
                        action={setLinkedTaskStatusFormAction.bind(
                          null,
                          orgSlug,
                          task.id,
                          detailHref
                        )}
                        status={task.status}
                      />
                      <Link
                        href={`${detailHref}?editTask=${task.id}`}
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                        })}
                      >
                        Edit
                      </Link>
                      <TaskDeleteDialog
                        action={deleteLinkedTaskFormAction.bind(
                          null,
                          orgSlug,
                          task.id,
                          detailHref
                        )}
                        taskTitle={task.title}
                      />
                    </div>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <TaskForm
          idPrefix="add-task"
          action={createLinkedTaskFormAction.bind(
            null,
            orgSlug,
            recordType,
            recordId,
            detailHref
          )}
          members={members}
          ariaLabel="Add task"
          submitLabel="Add task"
        />
      ) : null}
    </SectionCard>
  );
}
