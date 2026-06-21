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
import { CUSTOMER_TYPES } from "@/lib/customers/schemas";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { listCustomers } from "./actions";

type Customer = {
  id: string;
  name: string;
  type: string;
  email: string | null;
  phone: string | null;
  town: string | null;
};

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { orgSlug } = await params;
  const { type } = await searchParams;
  const activeType = (CUSTOMER_TYPES as readonly string[]).includes(type ?? "")
    ? type
    : undefined;

  const { membership } = await requireWorkspaceAccess(orgSlug);
  const canWrite = hasPermission(membership, "record.write");

  let customers: Customer[];
  try {
    customers = (await listCustomers(
      orgSlug,
      activeType ? { type: activeType } : {}
    )) as Customer[];
  } catch (error) {
    // No customers entitlement: back to the workspace overview rather than
    // a broken screen. Anything else is a real error.
    if (error instanceof AuthorisationError) {
      redirect(`/app/${orgSlug}`);
    }
    throw error;
  }

  return (
    <ListScreen
      title="Customers"
      description="The people and businesses your organisation works for."
      action={
        canWrite ? (
          <Link
            href={`/app/${orgSlug}/customers/new`}
            className={buttonVariants({ size: "sm" })}
          >
            New customer
          </Link>
        ) : null
      }
      filters={
        <nav
          aria-label="Filter by type"
          className="flex flex-wrap items-center gap-1.5"
        >
          <FilterPill
            href={`/app/${orgSlug}/customers`}
            label="All"
            active={!activeType}
          />
          {CUSTOMER_TYPES.map((value) => (
            <FilterPill
              key={value}
              href={`/app/${orgSlug}/customers?type=${value}`}
              label={value.charAt(0).toUpperCase() + value.slice(1)}
              active={activeType === value}
            />
          ))}
        </nav>
      }
      toolbarEnd={
        <Link
          href={`/app/${orgSlug}/customers/deleted`}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Deleted customers
        </Link>
      }
    >
      {customers.length === 0 ? (
        <EmptyState>
          {activeType
            ? `No ${activeType} customers.`
            : "No customers yet. They will appear here once added."}
        </EmptyState>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Town</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/app/${orgSlug}/customers/${customer.id}`}
                      className="block hover:underline"
                    >
                      {customer.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{customer.type}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {customer.email || ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {customer.phone || ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {customer.town || ""}
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
