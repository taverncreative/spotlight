import Link from "next/link";
import { NewQuoteForm } from "@/components/new-quote-form";
import {
  AuthorisationError,
  requireModuleEnabled,
  requirePermission,
} from "@/lib/authorisation";
import { NO_PERMISSION_MESSAGE } from "@/lib/form-state";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { createQuoteFormAction } from "../form-actions";

// New quote: choose a customer, optional title and valid-until; submitting
// creates the draft and lands on the builder. Gated like every create page.
export default async function NewQuotePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  let organisationId: string;
  try {
    const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
    await requireModuleEnabled(organisation, "quotes");
    requirePermission(membership, "record.write");
    organisationId = organisation.id;
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

  // Reading customer names is a normal membership read; no customers
  // module gate, consistent with the quote actions.
  const supabase = await createClient();
  const { data: customers } = await supabase
    .from("customers")
    .select("id, name")
    .eq("organisation_id", organisationId)
    .is("deleted_at", null)
    .order("name");

  const action = createQuoteFormAction.bind(null, orgSlug);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={`/app/${orgSlug}/quotes`}
        className="inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Back to quotes
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-medium tracking-tight">New quote</h1>
        <p className="text-sm text-muted-foreground">
          Choose the customer and a title; you will add line items next.
        </p>
      </div>
      {(customers ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Add a customer first; a quote needs one.
        </p>
      ) : (
        <div className="rounded-xl border bg-card p-6 shadow-soft">
          <NewQuoteForm action={action} customers={customers ?? []} />
        </div>
      )}
    </div>
  );
}
