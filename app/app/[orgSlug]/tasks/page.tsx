import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FilterPill } from "@/components/filter-pill";
import { ListScreen, EmptyState, TableCard } from "@/components/list-screen";
import { TaskStatusControl } from "@/components/task-status-control";
import { TaskDeleteDialog } from "@/components/task-delete-dialog";
import { AuthorisationError, hasPermission } from "@/lib/authorisation";
import { createClient } from "@/lib/supabase/server";
import { TASK_STATUSES } from "@/lib/tasks/schemas";
import {
  RELATED_LABELS,
  resolveRelatedRefs,
  type RelatedRef,
} from "@/lib/tasks/related";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { listOrganisationMembers } from "@/lib/members";
import { listTasks } from "./actions";
import { deleteTaskFormAction, setTaskStatusFormAction } from "./form-actions";

type Task = {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
  assigned_to: string | null;
  related_type: string | null;
  related_id: string | null;
  isOverdue: boolean;
};

type Member = { id: string; name: string };

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

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ status?: string; assignee?: string; overdue?: string }>;
}) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const { user, membership, organisation } = await requireWorkspaceAccess(orgSlug);
  const canWrite = hasPermission(membership, "record.write");

  const activeStatus = (TASK_STATUSES as readonly string[]).includes(
    sp.status ?? ""
  )
    ? sp.status
    : undefined;
  const overdue = sp.overdue === "1";

  let tasks: Task[];
  let members: Member[];
  let activeAssignee: string | undefined;
  try {
    members = await listOrganisationMembers(orgSlug);
    activeAssignee =
      sp.assignee === "me" || members.some((m) => m.id === sp.assignee)
        ? sp.assignee
        : undefined;

    const filter: Record<string, unknown> = {};
    if (activeStatus) filter.status = activeStatus;
    if (overdue) filter.overdue = true;
    if (activeAssignee === "me") filter.assigned_to = user.id;
    else if (activeAssignee) filter.assigned_to = activeAssignee;

    tasks = (await listTasks(orgSlug, filter)) as Task[];
  } catch (error) {
    // No tasks entitlement: send the member back to the workspace overview
    // rather than showing a broken screen. Anything else is a real error.
    if (error instanceof AuthorisationError) {
      redirect(`/app/${orgSlug}`);
    }
    throw error;
  }

  const nameById = new Map(members.map((m) => [m.id, m.name]));

  // Resolve the linked records' names in one query per type (never one per
  // row), so each linked task can show its record and link back to it.
  const supabase = await createClient();
  const relatedRefs = await resolveRelatedRefs(
    supabase,
    orgSlug,
    organisation.id,
    tasks
      .filter((t) => t.related_type && t.related_id)
      .map((t) => ({ type: t.related_type!, id: t.related_id! }))
  );

  // Filter links preserve the other active filters, so the three rows combine.
  const current = {
    status: activeStatus,
    assignee: activeAssignee,
    overdue: overdue ? "1" : undefined,
  };
  const hrefWith = (overrides: Record<string, string | undefined>) => {
    const merged = { ...current, ...overrides };
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) query.set(key, value);
    }
    const qs = query.toString();
    return qs ? `/app/${orgSlug}/tasks?${qs}` : `/app/${orgSlug}/tasks`;
  };

  return (
    <ListScreen
      title="Tasks"
      description="Work to be done across your organisation."
      action={
        canWrite ? (
          <Link
            href={`/app/${orgSlug}/tasks/new`}
            className={buttonVariants({ size: "sm" })}
          >
            New task
          </Link>
        ) : null
      }
      filters={
        <div className="w-full space-y-1.5">
          <nav aria-label="Filter by status" className="flex flex-wrap gap-1">
            <FilterPill
              href={hrefWith({ status: undefined })}
              label="All"
              active={!activeStatus}
            />
            {TASK_STATUSES.map((value) => (
              <FilterPill
                key={value}
                href={hrefWith({ status: value })}
                label={STATUS_LABELS[value]}
                active={activeStatus === value}
              />
            ))}
          </nav>

          <nav aria-label="Filter by assignee" className="flex flex-wrap gap-1">
            <FilterPill
              href={hrefWith({ assignee: undefined })}
              label="All assignees"
              active={!activeAssignee}
            />
            <FilterPill
              href={hrefWith({ assignee: "me" })}
              label="Me"
              active={activeAssignee === "me"}
            />
            {members.map((member) => (
              <FilterPill
                key={member.id}
                href={hrefWith({ assignee: member.id })}
                label={member.name}
                active={activeAssignee === member.id}
              />
            ))}
          </nav>

          <nav aria-label="Filter by due" className="flex flex-wrap gap-1">
            <FilterPill
              href={hrefWith({ overdue: overdue ? undefined : "1" })}
              label="Overdue"
              active={overdue}
            />
          </nav>
        </div>
      }
    >
      {tasks.length === 0 ? (
        <EmptyState>No tasks match these filters.</EmptyState>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Linked</TableHead>
                {canWrite ? <TableHead>Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell className="font-medium">{task.title}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGES[task.status] ?? "secondary"}>
                      {STATUS_LABELS[task.status] ?? task.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {task.due_at ? (
                      <span
                        className={
                          task.isOverdue ? "font-medium text-destructive" : ""
                        }
                      >
                        {formatDate(task.due_at)}
                        {task.isOverdue ? " (overdue)" : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">No date</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {task.assigned_to
                      ? nameById.get(task.assigned_to) ?? "Unknown"
                      : "Unassigned"}
                  </TableCell>
                  <TableCell>
                    <LinkedCell
                      type={task.related_type}
                      id={task.related_id}
                      refs={relatedRefs}
                    />
                  </TableCell>
                  {canWrite ? (
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <TaskStatusControl
                          action={setTaskStatusFormAction.bind(
                            null,
                            orgSlug,
                            task.id
                          )}
                          status={task.status}
                        />
                        <Link
                          href={`/app/${orgSlug}/tasks/${task.id}/edit`}
                          className={buttonVariants({
                            variant: "outline",
                            size: "sm",
                          })}
                        >
                          Edit
                        </Link>
                        <TaskDeleteDialog
                          action={deleteTaskFormAction.bind(
                            null,
                            orgSlug,
                            task.id
                          )}
                          taskTitle={task.title}
                        />
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </ListScreen>
  );
}

// The linked-record cell: the type badge plus the record's name, linking to its
// page where it has one (sites have no page, so no link). A record that was
// hard-deleted does not resolve, so it degrades to the type and "unavailable"
// rather than crashing.
function LinkedCell({
  type,
  id,
  refs,
}: {
  type: string | null;
  id: string | null;
  refs: Map<string, RelatedRef>;
}) {
  if (!type || !id) {
    return <span className="text-muted-foreground">—</span>;
  }
  const label = RELATED_LABELS[type] ?? type;
  const ref = refs.get(`${type}:${id}`);
  if (!ref) {
    return (
      <span className="text-muted-foreground">{label}: unavailable</span>
    );
  }
  const inner = (
    <span className="inline-flex items-center gap-1">
      <Badge variant="outline">{label}</Badge>
      <span>{ref.name}</span>
    </span>
  );
  return ref.href ? (
    <Link href={ref.href} className="underline underline-offset-4">
      {inner}
    </Link>
  ) : (
    inner
  );
}
