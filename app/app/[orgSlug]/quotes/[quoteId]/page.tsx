import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CopyQuoteLink } from "@/components/copy-quote-link";
import { CreateJobFromQuoteDialog } from "@/components/create-job-from-quote-dialog";
import { DeleteRecordDialog } from "@/components/delete-record-dialog";
import { MarkSentDialog } from "@/components/mark-sent-dialog";
import { TasksSection } from "@/components/tasks-section";
import { NotesSection } from "@/components/notes-section";
import { FilesSection } from "@/components/files-section";
import { TransitionButton } from "@/components/transition-button";
import { buttonVariants } from "@/components/ui/button";
import {
  RecordDetailShell,
  DetailFields,
  DetailField,
} from "@/components/record-detail";
import { SectionCard } from "@/components/section-card";
import {
  AuthorisationError,
  hasPermission,
  isModuleEnabled,
} from "@/lib/authorisation";
import { formatPence } from "@/lib/currency";
import { goneMessage } from "@/lib/form-state";
import { siteAddressSummary, type QuoteSite } from "@/lib/quotes/site-summary";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { createJobFromQuoteFormAction } from "@/app/app/[orgSlug]/jobs/form-actions";
import { getQuote } from "../actions";
import {
  softDeleteQuoteFormAction,
  transitionQuoteFormAction,
} from "../form-actions";

type QuoteDetail = {
  id: string;
  quote_number: number;
  title: string | null;
  status: string;
  issued_at: string | null;
  valid_until: string | null;
  subtotal_pence: number;
  vat_pence: number;
  total_pence: number;
  public_token: string | null;
  created_at: string;
  customers: { name: string } | null;
  sites: QuoteSite | null;
  quote_line_items: {
    id: string;
    position: number;
    description: string;
    quantity: number;
    unit_price_pence: number;
    vat_rate: number;
    line_total_pence: number;
  }[];
};

const STATUS_BADGES: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "secondary",
  sent: "default",
  accepted: "outline",
  declined: "destructive",
  expired: "outline",
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function QuoteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; quoteId: string }>;
  searchParams: Promise<{ editTask?: string; editNote?: string }>;
}) {
  const { orgSlug, quoteId } = await params;
  const { editTask, editNote } = await searchParams;
  const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
  const canWrite = hasPermission(membership, "record.write");
  const jobsEnabled = await isModuleEnabled(organisation, "jobs");

  let quote: QuoteDetail | null;
  try {
    quote = (await getQuote(orgSlug, {
      id: quoteId,
    })) as unknown as QuoteDetail | null;
  } catch (error) {
    if (error instanceof AuthorisationError) {
      redirect(`/app/${orgSlug}`);
    }
    throw error;
  }

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

  const detailHref = `/app/${orgSlug}/quotes/${quote.id}`;
  const siteSummary = quote.sites ? siteAddressSummary(quote.sites) : "";
  const showActions = canWrite || quote.status !== "draft";

  return (
    <RecordDetailShell
      title={`Quote #${quote.quote_number}${quote.title ? ` ${quote.title}` : ""}`}
      status={
        <Badge variant={STATUS_BADGES[quote.status] ?? "secondary"}>
          {quote.status}
        </Badge>
      }
      meta={
        <div className="space-y-0.5 text-sm text-muted-foreground">
          <p>{quote.customers?.name ?? "Unknown customer"}</p>
          {quote.sites ? (
            <p>
              Site: {quote.sites.name}
              {siteSummary ? `, ${siteSummary}` : ""}
            </p>
          ) : null}
        </div>
      }
      actions={
        showActions ? (
          <>
            {canWrite && quote.status === "draft" ? (
              <>
                <Link
                  href={`/app/${orgSlug}/quotes/${quote.id}/edit`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Edit
                </Link>
                <MarkSentDialog
                  action={transitionQuoteFormAction.bind(
                    null,
                    orgSlug,
                    quote.id,
                    "sent"
                  )}
                />
              </>
            ) : null}
            {canWrite && quote.status === "sent" ? (
              <>
                <TransitionButton
                  label="Accepted"
                  variant="default"
                  action={transitionQuoteFormAction.bind(
                    null,
                    orgSlug,
                    quote.id,
                    "accepted"
                  )}
                />
                <TransitionButton
                  label="Declined"
                  action={transitionQuoteFormAction.bind(
                    null,
                    orgSlug,
                    quote.id,
                    "declined"
                  )}
                />
                <TransitionButton
                  label="Expired"
                  action={transitionQuoteFormAction.bind(
                    null,
                    orgSlug,
                    quote.id,
                    "expired"
                  )}
                />
                <TransitionButton
                  label="Back to draft"
                  action={transitionQuoteFormAction.bind(
                    null,
                    orgSlug,
                    quote.id,
                    "draft"
                  )}
                />
              </>
            ) : null}
            {quote.status !== "draft" ? (
              <a
                href={`/app/${orgSlug}/quotes/${quote.id}/pdf`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Download PDF
              </a>
            ) : null}
            {canWrite && jobsEnabled ? (
              <CreateJobFromQuoteDialog
                action={createJobFromQuoteFormAction.bind(
                  null,
                  orgSlug,
                  quote.id
                )}
              />
            ) : null}
            {canWrite ? (
              <DeleteRecordDialog
                action={softDeleteQuoteFormAction.bind(null, orgSlug, quote.id)}
                entity="quote"
                itemName={`Quote #${quote.quote_number}`}
              />
            ) : null}
          </>
        ) : undefined
      }
      fields={
        <>
          <DetailFields>
            <DetailField
              label="Issued"
              value={quote.issued_at ? formatDate(quote.issued_at) : null}
            />
            <DetailField
              label="Valid until"
              value={quote.valid_until ? formatDate(quote.valid_until) : null}
            />
            <DetailField label="Created" value={formatDate(quote.created_at)} />
          </DetailFields>
          {canWrite && quote.status !== "draft" && quote.public_token ? (
            <CopyQuoteLink token={quote.public_token} />
          ) : null}
        </>
      }
      backHref={`/app/${orgSlug}/quotes`}
      backLabel="Back to quotes"
    >
      <SectionCard title="Line items">
        {quote.quote_line_items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No line items yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">VAT</TableHead>
                  <TableHead className="text-right">Line total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quote.quote_line_items.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium">
                      {line.description}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.quantity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPence(line.unit_price_pence)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.vat_rate}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPence(line.line_total_pence)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
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
            <dd className="tabular-nums">{formatPence(quote.total_pence)}</dd>
          </div>
        </dl>
      </SectionCard>

      <TasksSection
        orgSlug={orgSlug}
        recordType="quote"
        recordId={quote.id}
        detailHref={detailHref}
        editTaskId={editTask}
      />

      <NotesSection
        orgSlug={orgSlug}
        recordType="quote"
        recordId={quote.id}
        detailHref={detailHref}
        editNoteId={editNote}
      />

      <FilesSection
        orgSlug={orgSlug}
        recordType="quote"
        recordId={quote.id}
        detailHref={detailHref}
      />
    </RecordDetailShell>
  );
}
