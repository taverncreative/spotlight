import Link from "next/link";
import { redirect } from "next/navigation";
import { AddLineForm } from "@/components/add-line-form";
import { LineItemDisplay } from "@/components/line-item-display";
import { LineItemRow, type LineItem } from "@/components/line-item-row";
import { QuoteHeaderForm } from "@/components/quote-header-form";
import { SectionCard } from "@/components/section-card";
import { Badge } from "@/components/ui/badge";
import {
  AuthorisationError,
  requireModuleEnabled,
  requirePermission,
} from "@/lib/authorisation";
import { formatPence } from "@/lib/currency";
import { buttonVariants } from "@/components/ui/button";
import { goneMessage, NO_PERMISSION_MESSAGE } from "@/lib/form-state";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { getQuote } from "../../actions";
import {
  addLineItemFormAction,
  removeLineItemFormAction,
  updateLineItemFormAction,
  updateQuoteFormAction,
} from "../../form-actions";

type QuoteForBuilder = {
  id: string;
  quote_number: number;
  title: string | null;
  status: string;
  customer_id: string;
  site_id: string | null;
  valid_until: string | null;
  subtotal_pence: number;
  vat_pence: number;
  total_pence: number;
  quote_line_items: LineItem[];
};

// The builder: header, lines and totals. Every operation is a discrete
// server action that redirects back here, so the totals shown are always
// the database's own numbers via getQuote.
export default async function QuoteBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; quoteId: string }>;
  searchParams: Promise<{ editLine?: string }>;
}) {
  const { orgSlug, quoteId } = await params;
  const { editLine } = await searchParams;

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

  const quote = (await getQuote(orgSlug, {
    id: quoteId,
  })) as unknown as QuoteForBuilder | null;

  if (!quote) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{goneMessage("quote")}</p>
        <Link
          href={`/app/${orgSlug}/quotes`}
          className="text-sm underline underline-offset-4"
        >
          Back to quotes
        </Link>
      </div>
    );
  }

  // Editing locks outside draft: the builder only opens draft quotes.
  if (quote.status !== "draft") {
    redirect(`/app/${orgSlug}/quotes/${quote.id}`);
  }

  const supabase = await createClient();
  const { data: customers } = await supabase
    .from("customers")
    .select("id, name")
    .eq("organisation_id", organisationId)
    .is("deleted_at", null)
    .order("name");

  // The site picker offers the quote's current customer's active sites.
  const { data: sites } = await supabase
    .from("sites")
    .select("id, name")
    .eq("organisation_id", organisationId)
    .eq("customer_id", quote.customer_id)
    .is("deleted_at", null)
    .order("name");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={`/app/${orgSlug}/quotes/${quote.id}`}
        className="inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Back to quote
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-medium tracking-tight">
          Edit quote #{quote.quote_number}
        </h1>
        <Badge variant="secondary">{quote.status}</Badge>
      </div>

      <SectionCard title="Quote details">
        <QuoteHeaderForm
          action={updateQuoteFormAction.bind(null, orgSlug, quote.id)}
          customers={customers ?? []}
          sites={sites ?? []}
          initial={{
            title: quote.title,
            customer_id: quote.customer_id,
            valid_until: quote.valid_until,
            site_id: quote.site_id,
          }}
        />
      </SectionCard>

      <SectionCard title="Line items">
        {quote.quote_line_items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No line items yet.</p>
        ) : (
          <div className="space-y-3">
            {quote.quote_line_items.map((line) =>
              line.id === editLine ? (
                <LineItemRow
                  key={line.id}
                  line={line}
                  saveAction={updateLineItemFormAction.bind(
                    null,
                    orgSlug,
                    quote.id,
                    line.id
                  )}
                  cancelHref={`/app/${orgSlug}/quotes/${quote.id}/edit`}
                />
              ) : (
                <LineItemDisplay
                  key={line.id}
                  line={line}
                  editHref={`/app/${orgSlug}/quotes/${quote.id}/edit?editLine=${line.id}`}
                  removeAction={removeLineItemFormAction.bind(
                    null,
                    orgSlug,
                    quote.id,
                    line.id
                  )}
                />
              )
            )}
          </div>
        )}

        <AddLineForm
          action={addLineItemFormAction.bind(null, orgSlug, quote.id)}
        />

        <dl className="ml-auto w-full max-w-xs space-y-1 border-t pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular-nums">{formatPence(quote.subtotal_pence)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">VAT</dt>
            <dd className="tabular-nums">{formatPence(quote.vat_pence)}</dd>
          </div>
          <div className="flex justify-between border-t pt-2 font-medium">
            <dt>Total</dt>
            <dd data-testid="quote-total" className="tabular-nums">
              {formatPence(quote.total_pence)}
            </dd>
          </div>
        </dl>
      </SectionCard>

      <Link
        href={`/app/${orgSlug}/quotes/${quote.id}`}
        className={buttonVariants()}
      >
        Done
      </Link>
    </div>
  );
}
