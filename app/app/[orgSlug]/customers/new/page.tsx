import { CustomerForm } from "@/components/customer-form";
import { FormScreen } from "@/components/form-screen";
import {
  AuthorisationError,
  requireModuleEnabled,
  requirePermission,
} from "@/lib/authorisation";
import { NO_PERMISSION_MESSAGE } from "@/lib/form-state";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { createCustomerFormAction } from "../form-actions";

// The create form. The page gate mirrors the action's: hiding the New
// customer button is a courtesy, this page and the action enforce.
export default async function NewCustomerPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  try {
    const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
    await requireModuleEnabled(organisation, "customers");
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

  const action = createCustomerFormAction.bind(null, orgSlug);

  return (
    <FormScreen
      backHref={`/app/${orgSlug}/customers`}
      backLabel="Back to customers"
      title="New customer"
      description="Add a customer your organisation works with."
    >
      <CustomerForm action={action} submitLabel="Create customer" />
    </FormScreen>
  );
}
