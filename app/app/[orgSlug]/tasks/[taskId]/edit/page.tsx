import Link from "next/link";
import { TaskForm } from "@/components/task-form";
import { FormScreen } from "@/components/form-screen";
import {
  AuthorisationError,
  requireModuleEnabled,
  requirePermission,
} from "@/lib/authorisation";
import { goneMessage, NO_PERMISSION_MESSAGE } from "@/lib/form-state";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { listOrganisationMembers } from "@/lib/members";
import { getTask } from "../../actions";
import { updateTaskFormAction } from "../../form-actions";

type TaskRecord = {
  id: string;
  title: string;
  description: string | null;
  due_at: string | null;
  assigned_to: string | null;
  status: string;
};

// The edit form. Status is changed through the quick control on the list, so
// the edit form covers the descriptive fields only. Gated like the create
// page; the hidden Edit control is a courtesy, this page and the action
// enforce.
export default async function EditTaskPage({
  params,
}: {
  params: Promise<{ orgSlug: string; taskId: string }>;
}) {
  const { orgSlug, taskId } = await params;

  let task: TaskRecord | null;
  let members: { id: string; name: string }[];
  try {
    const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
    await requireModuleEnabled(organisation, "tasks");
    requirePermission(membership, "record.write");
    members = await listOrganisationMembers(orgSlug);
    task = (await getTask(orgSlug, { id: taskId })) as TaskRecord | null;
  } catch (error) {
    if (error instanceof AuthorisationError) {
      return (
        <p role="alert" className="text-sm text-muted-foreground">
          {NO_PERMISSION_MESSAGE}
        </p>
      );
    }
    throw error;
  }

  if (!task) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{goneMessage("task")}</p>
        <Link
          href={`/app/${orgSlug}/tasks`}
          className="text-sm underline underline-offset-4"
        >
          Back to tasks
        </Link>
      </div>
    );
  }

  const action = updateTaskFormAction.bind(null, orgSlug, task.id);

  return (
    <FormScreen
      backHref={`/app/${orgSlug}/tasks`}
      backLabel="Back to tasks"
      title="Edit task"
    >
      <TaskForm
        action={action}
        members={members}
        ariaLabel="Edit task"
        initial={task}
        submitLabel="Save changes"
      />
    </FormScreen>
  );
}
