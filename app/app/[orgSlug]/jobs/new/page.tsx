import { JobForm } from "@/components/job-form";
import { FormScreen } from "@/components/form-screen";
import {
  AuthorisationError,
  requireModuleEnabled,
  requirePermission,
} from "@/lib/authorisation";
import { NO_PERMISSION_MESSAGE } from "@/lib/form-state";
import { loadJobFormOptions } from "@/lib/jobs/form-data";
import { listOrganisationMembers } from "@/lib/members";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { createJobFormAction } from "../form-actions";

// The create form. The page gate mirrors the action's: hiding the New job button
// is a courtesy, this page (and the action beneath it) enforce.
export default async function NewJobPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  let options: Awaited<ReturnType<typeof loadJobFormOptions>>;
  let members: { id: string; name: string }[];
  try {
    const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
    await requireModuleEnabled(organisation, "jobs");
    requirePermission(membership, "record.write");
    options = await loadJobFormOptions(organisation.id);
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

  return (
    <FormScreen
      backHref={`/app/${orgSlug}/jobs`}
      backLabel="Back to jobs"
      title="New job"
      description="Schedule a piece of work for a customer."
    >
      <JobForm
        action={createJobFormAction.bind(null, orgSlug)}
        customers={options.customers}
        sites={options.sites}
        members={members}
        submitLabel="Create job"
        cancelHref={`/app/${orgSlug}/jobs`}
        allowRepeat
      />
    </FormScreen>
  );
}
