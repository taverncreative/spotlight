import { LeadForm } from "@/components/lead-form";
import { FormScreen } from "@/components/form-screen";
import {
  AuthorisationError,
  requireModuleEnabled,
  requirePermission,
} from "@/lib/authorisation";
import { NO_PERMISSION_MESSAGE } from "@/lib/form-state";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { createLeadFormAction } from "../form-actions";

// The create form. The page gate mirrors the action's: hiding the New lead
// button is a courtesy, this page (and the action beneath it) enforce.
export default async function NewLeadPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  try {
    const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
    await requireModuleEnabled(organisation, "leads");
    requirePermission(membership, "record.write");
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

  const action = createLeadFormAction.bind(null, orgSlug);

  return (
    <FormScreen
      backHref={`/app/${orgSlug}/leads`}
      backLabel="Back to leads"
      title="New lead"
      description="Record an enquiry your organisation has received."
    >
      <LeadForm action={action} submitLabel="Create lead" />
    </FormScreen>
  );
}
