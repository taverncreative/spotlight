import Link from "next/link";
import { SavingsForm } from "@/components/savings-form";
import { FormScreen } from "@/components/form-screen";
import {
  AuthorisationError,
  requireModuleEnabled,
  requirePermission,
} from "@/lib/authorisation";
import { goneMessage, NO_PERMISSION_MESSAGE } from "@/lib/form-state";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { getSavingsItem } from "../../actions";
import { updateSavingsItemFormAction } from "../../form-actions";

type SavingsRecord = {
  id: string;
  label: string;
  amount_pence: number;
  cadence: string;
  note: string | null;
  cancelled_on: string | null;
};

// The edit form. Gated like the add page; the hidden Edit control is a
// courtesy, this page and the action enforce. The stored pence is shown back in
// pounds for editing.
export default async function EditSavingsItemPage({
  params,
}: {
  params: Promise<{ orgSlug: string; savingsItemId: string }>;
}) {
  const { orgSlug, savingsItemId } = await params;

  let item: SavingsRecord | null;
  try {
    const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
    await requireModuleEnabled(organisation, "subscription_savings");
    requirePermission(membership, "record.write");
    item = (await getSavingsItem(orgSlug, {
      id: savingsItemId,
    })) as SavingsRecord | null;
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

  if (!item) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {goneMessage("savings item")}
        </p>
        <Link
          href={`/app/${orgSlug}/savings`}
          className="text-sm underline underline-offset-4"
        >
          Back to savings
        </Link>
      </div>
    );
  }

  const action = updateSavingsItemFormAction.bind(null, orgSlug, item.id);

  return (
    <FormScreen
      backHref={`/app/${orgSlug}/savings`}
      backLabel="Back to savings"
      title="Edit savings item"
    >
      <SavingsForm
        action={action}
        ariaLabel="Edit savings item"
        submitLabel="Save changes"
        initial={{
          label: item.label,
          amount: (item.amount_pence / 100).toFixed(2),
          cadence: item.cadence,
          note: item.note,
          cancelled_on: item.cancelled_on,
        }}
      />
    </FormScreen>
  );
}
