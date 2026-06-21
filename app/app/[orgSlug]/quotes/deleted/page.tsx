import Link from "next/link";
import { redirect } from "next/navigation";
import { RestoreRecordButton } from "@/components/restore-record-button";
import { Badge } from "@/components/ui/badge";
import { ListScreen, EmptyState, TableCard } from "@/components/list-screen";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AuthorisationError, hasPermission } from "@/lib/authorisation";
import { formatPence } from "@/lib/currency";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { listDeletedQuotes } from "../actions";
import { restoreQuoteFormAction } from "../form-actions";

type DeletedQuote = {
  id: string;
  quote_number: number;
  title: string | null;
  status: string;
  total_pence: number;
  deleted_at: string;
  customers: { name: string } | null;
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function DeletedQuotesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { membership } = await requireWorkspaceAccess(orgSlug);
  const canWrite = hasPermission(membership, "record.write");

  let quotes: DeletedQuote[];
  try {
    quotes = (await listDeletedQuotes(orgSlug)) as unknown as DeletedQuote[];
  } catch (error) {
    if (error instanceof AuthorisationError) {
      redirect(`/app/${orgSlug}`);
    }
    throw error;
  }

  return (
    <ListScreen
      title="Deleted quotes"
      description="Deleted quotes can be restored at any time, in the status they left."
      toolbarEnd={
        <Link
          href={`/app/${orgSlug}/quotes`}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Back to quotes
        </Link>
      }
    >
      {quotes.length === 0 ? (
        <EmptyState>No deleted quotes.</EmptyState>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quote</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Deleted</TableHead>
                {canWrite ? <TableHead className="w-28" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.map((quote) => (
                <TableRow key={quote.id}>
                  <TableCell className="font-medium">
                    #{quote.quote_number}
                    {quote.title ? ` ${quote.title}` : ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {quote.customers?.name ?? ""}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{quote.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPence(quote.total_pence)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(quote.deleted_at)}
                  </TableCell>
                  {canWrite ? (
                    <TableCell>
                      <RestoreRecordButton
                        action={restoreQuoteFormAction.bind(
                          null,
                          orgSlug,
                          quote.id
                        )}
                      />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </ListScreen>
  );
}
