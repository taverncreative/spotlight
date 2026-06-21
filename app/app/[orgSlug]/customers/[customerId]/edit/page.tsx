import Link from "next/link";
import { CustomerForm } from "@/components/customer-form";
import { FormScreen } from "@/components/form-screen";
import {
  AuthorisationError,
  requireModuleEnabled,
  requirePermission,
} from "@/lib/authorisation";
import { goneMessage, NO_PERMISSION_MESSAGE } from "@/lib/form-state";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { getCustomer } from "../../actions";
import { updateCustomerFormAction } from "../../form-actions";

type Customer = {
  id: string;
  name: string;
  type: string;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  town: string | null;
  county: string | null;
  postcode: string | null;
};

// The edit form. Gated like the create page: the hidden Edit control is a
// courtesy, this page and the action enforce.
export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ orgSlug: string; customerId: string }>;
}) {
  const { orgSlug, customerId } = await params;

  let customer: Customer | null;
  try {
    const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
    await requireModuleEnabled(organisation, "customers");
    requirePermission(membership, "record.write");
    customer = (await getCustomer(orgSlug, {
      id: customerId,
    })) as Customer | null;
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

  if (!customer) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {goneMessage("customer")}
        </p>
        <Link
          href={`/app/${orgSlug}/customers`}
          className="text-sm underline underline-offset-4"
        >
          Back to customers
        </Link>
      </div>
    );
  }

  const action = updateCustomerFormAction.bind(null, orgSlug, customer.id);

  return (
    <FormScreen
      backHref={`/app/${orgSlug}/customers`}
      backLabel="Back to customers"
      title="Edit customer"
    >
      <CustomerForm
        action={action}
        initial={customer}
        submitLabel="Save changes"
      />
    </FormScreen>
  );
}
