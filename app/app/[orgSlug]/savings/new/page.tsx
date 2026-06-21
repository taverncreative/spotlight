import { SavingsForm } from "@/components/savings-form";
import { FormScreen } from "@/components/form-screen";
import {
  AuthorisationError,
  requireModuleEnabled,
  requirePermission,
} from "@/lib/authorisation";
import { NO_PERMISSION_MESSAGE } from "@/lib/form-state";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { createSavingsItemFormAction } from "../form-actions";

// The add form. The page gate mirrors the action's: hiding the New item button
// is a courtesy, this page (and the action beneath it) enforce.
export default async function NewSavingsItemPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  try {
    const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
    await requireModuleEnabled(organisation, "subscription_savings");
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

  const action = createSavingsItemFormAction.bind(null, orgSlug);

  return (
    <FormScreen
      backHref={`/app/${orgSlug}/savings`}
      backLabel="Back to savings"
      title="New savings item"
      description="Record a subscription you have cancelled."
    >
      <SavingsForm
        action={action}
        ariaLabel="New savings item"
        submitLabel="Add item"
      />
    </FormScreen>
  );
}
