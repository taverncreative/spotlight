import Link from "next/link";
import { LeadForm } from "@/components/lead-form";
import { FormScreen } from "@/components/form-screen";
import {
  AuthorisationError,
  requireModuleEnabled,
  requirePermission,
} from "@/lib/authorisation";
import { GONE_MESSAGE, NO_PERMISSION_MESSAGE } from "@/lib/form-state";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { getLead } from "../../actions";
import { updateLeadFormAction } from "../../form-actions";

type Lead = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  source: string | null;
  status: string;
};

// The edit form. Gated like the create page: the hidden Edit control is a
// courtesy, this page and the action enforce.
export default async function EditLeadPage({
  params,
}: {
  params: Promise<{ orgSlug: string; leadId: string }>;
}) {
  const { orgSlug, leadId } = await params;

  let lead: Lead | null;
  try {
    const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
    await requireModuleEnabled(organisation, "leads");
    requirePermission(membership, "record.write");
    lead = (await getLead(orgSlug, { id: leadId })) as Lead | null;
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

  if (!lead) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{GONE_MESSAGE}</p>
        <Link
          href={`/app/${orgSlug}/leads`}
          className="text-sm underline underline-offset-4"
        >
          Back to leads
        </Link>
      </div>
    );
  }

  const action = updateLeadFormAction.bind(null, orgSlug, lead.id);

  return (
    <FormScreen
      backHref={`/app/${orgSlug}/leads`}
      backLabel="Back to leads"
      title="Edit lead"
    >
      <LeadForm
        action={action}
        initial={lead}
        showStatus
        submitLabel="Save changes"
      />
    </FormScreen>
  );
}
