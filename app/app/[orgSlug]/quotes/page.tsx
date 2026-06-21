import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { FilterPill } from "@/components/filter-pill";
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
import { QUOTE_STATUSES } from "@/lib/quotes/schemas";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { listQuotes } from "./actions";

type QuoteRow = {
  id: string;
  quote_number: number;
  title: string | null;
  status: string;
  total_pence: number;
  created_at: string;
  customers: { name: string } | null;
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

export default async function QuotesPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { orgSlug } = await params;
  const { status } = await searchParams;
  const activeStatus = (QUOTE_STATUSES as readonly string[]).includes(
    status ?? ""
  )
    ? status
    : undefined;

  const { membership } = await requireWorkspaceAccess(orgSlug);
  const canWrite = hasPermission(membership, "record.write");

  let quotes: QuoteRow[];
  try {
    quotes = (await listQuotes(
      orgSlug,
      activeStatus ? { status: activeStatus } : {}
    )) as unknown as QuoteRow[];
  } catch (error) {
    if (error instanceof AuthorisationError) {
      redirect(`/app/${orgSlug}`);
    }
    throw error;
  }

  return (
    <ListScreen
      title="Quotes"
      description="Quotes your organisation has prepared for its customers."
      action={
        canWrite ? (
          <Link
            href={`/app/${orgSlug}/quotes/new`}
            className={buttonVariants({ size: "sm" })}
          >
            New quote
          </Link>
        ) : null
      }
      filters={
        <nav
          aria-label="Filter by status"
          className="flex flex-wrap items-center gap-1.5"
        >
          <FilterPill
            href={`/app/${orgSlug}/quotes`}
            label="All"
            active={!activeStatus}
          />
          {QUOTE_STATUSES.map((value) => (
            <FilterPill
              key={value}
              href={`/app/${orgSlug}/quotes?status=${value}`}
              label={value.charAt(0).toUpperCase() + value.slice(1)}
              active={activeStatus === value}
            />
          ))}
        </nav>
      }
      toolbarEnd={
        <Link
          href={`/app/${orgSlug}/quotes/deleted`}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Deleted quotes
        </Link>
      }
    >
      {quotes.length === 0 ? (
        <EmptyState>
          {activeStatus
            ? `No ${activeStatus} quotes.`
            : "No quotes yet. They will appear here once created."}
        </EmptyState>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quote</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quotes.map((quote) => (
                <TableRow key={quote.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/app/${orgSlug}/quotes/${quote.id}`}
                      className="block hover:underline"
                    >
                      #{quote.quote_number}
                      {quote.title ? ` ${quote.title}` : ""}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {quote.customers?.name ?? ""}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGES[quote.status] ?? "secondary"}>
                      {quote.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPence(quote.total_pence)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(quote.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </ListScreen>
  );
}
