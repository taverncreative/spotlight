import { TaskForm } from "@/components/task-form";
import { FormScreen } from "@/components/form-screen";
import {
  AuthorisationError,
  requireModuleEnabled,
  requirePermission,
} from "@/lib/authorisation";
import { NO_PERMISSION_MESSAGE } from "@/lib/form-state";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { listOrganisationMembers } from "@/lib/members";
import { createTaskFormAction } from "../form-actions";

// The create form. The page gate mirrors the action's: hiding the New task
// button is a courtesy, this page (and the action beneath it) enforce.
export default async function NewTaskPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  let members: { id: string; name: string }[];
  try {
    const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
    await requireModuleEnabled(organisation, "tasks");
    requirePermission(membership, "record.write");
    members = await listOrganisationMembers(orgSlug);
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

  const action = createTaskFormAction.bind(null, orgSlug);

  return (
    <FormScreen
      backHref={`/app/${orgSlug}/tasks`}
      backLabel="Back to tasks"
      title="New task"
      description="Add work to be done across your organisation."
    >
      <TaskForm
        action={action}
        members={members}
        ariaLabel="New task"
        includeStatus
        submitLabel="Create task"
      />
    </FormScreen>
  );
}
