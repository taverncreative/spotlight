import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ListScreen, EmptyState, TableCard } from "@/components/list-screen";
import { SavingsDeleteDialog } from "@/components/savings-delete-dialog";
import { AuthorisationError, hasPermission } from "@/lib/authorisation";
import { formatPence } from "@/lib/currency";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { listSavings } from "./actions";
import { deleteSavingsItemFormAction } from "./form-actions";

type SavingsItem = {
  id: string;
  label: string;
  amount_pence: number;
  cadence: string;
  note: string | null;
  cancelled_on: string | null;
};

function cadenceSuffix(cadence: string) {
  return cadence === "annual" ? "per year" : "per month";
}

// A date-only value ("2026-05-01") read at UTC so the displayed day never
// shifts with the server timezone.
function formatCancelledOn(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

export default async function SavingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { membership } = await requireWorkspaceAccess(orgSlug);
  const canWrite = hasPermission(membership, "record.write");

  let items: SavingsItem[];
  let totals: { monthlyTotalPence: number; annualTotalPence: number };
  try {
    const result = await listSavings(orgSlug);
    items = result.items as SavingsItem[];
    totals = result.totals;
  } catch (error) {
    // No subscription_savings entitlement: send the member back to the
    // workspace overview rather than showing a broken screen. Anything else is
    // a real error.
    if (error instanceof AuthorisationError) {
      redirect(`/app/${orgSlug}`);
    }
    throw error;
  }

  return (
    <ListScreen
      title="Savings"
      description="What you have saved by cancelling subscriptions you no longer need."
      action={
        canWrite ? (
          <Link
            href={`/app/${orgSlug}/savings/new`}
            className={buttonVariants({ size: "sm" })}
          >
            New item
          </Link>
        ) : null
      }
    >
      {/* The value story: the total saving, the visual focus of the page. */}
      <section
        aria-label="Total saving"
        className="rounded-xl border bg-card p-6 shadow-soft"
      >
        <h2 className="text-sm font-medium text-muted-foreground">
          Your total saving
        </h2>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-12 gap-y-4">
          <div>
            <p
              data-testid="savings-monthly-total"
              className="text-4xl font-semibold tracking-tight tabular-nums"
            >
              {formatPence(totals.monthlyTotalPence)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">per month</p>
          </div>
          <div>
            <p
              data-testid="savings-annual-total"
              className="text-4xl font-semibold tracking-tight tabular-nums"
            >
              {formatPence(totals.annualTotalPence)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">per year</p>
          </div>
        </div>
      </section>

      {items.length === 0 ? (
        <EmptyState>
          No savings items yet.
          {canWrite ? " Add the first cancelled subscription above." : null}
        </EmptyState>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Cancelled on</TableHead>
                {canWrite ? <TableHead>Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="align-top">
                    <div className="font-medium">{item.label}</div>
                    {item.note ? (
                      <div className="mt-1 text-sm text-muted-foreground">
                        {item.note}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="align-top tabular-nums">
                    {formatPence(item.amount_pence)}{" "}
                    <span className="text-muted-foreground">
                      {cadenceSuffix(item.cadence)}
                    </span>
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground">
                    {item.cancelled_on
                      ? formatCancelledOn(item.cancelled_on)
                      : "Not recorded"}
                  </TableCell>
                  {canWrite ? (
                    <TableCell className="align-top">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/app/${orgSlug}/savings/${item.id}/edit`}
                          className={buttonVariants({
                            variant: "outline",
                            size: "sm",
                          })}
                        >
                          Edit
                        </Link>
                        <SavingsDeleteDialog
                          action={deleteSavingsItemFormAction.bind(
                            null,
                            orgSlug,
                            item.id
                          )}
                          itemLabel={item.label}
                        />
                      </div>
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
