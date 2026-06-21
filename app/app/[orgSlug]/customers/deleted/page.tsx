import Link from "next/link";
import { redirect } from "next/navigation";
import { RestoreRecordButton } from "@/components/restore-record-button";
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
import { requireWorkspaceAccess } from "@/lib/workspace";
import { listDeletedCustomers } from "../actions";
import { restoreCustomerFormAction } from "../form-actions";

type DeletedCustomer = {
  id: string;
  name: string;
  email: string | null;
  deleted_at: string;
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function DeletedCustomersPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { membership } = await requireWorkspaceAccess(orgSlug);
  const canWrite = hasPermission(membership, "record.write");

  let customers: DeletedCustomer[];
  try {
    customers = (await listDeletedCustomers(orgSlug)) as DeletedCustomer[];
  } catch (error) {
    if (error instanceof AuthorisationError) {
      redirect(`/app/${orgSlug}`);
    }
    throw error;
  }

  return (
    <ListScreen
      title="Deleted customers"
      description="Deleted customers can be restored at any time."
      toolbarEnd={
        <Link
          href={`/app/${orgSlug}/customers`}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Back to customers
        </Link>
      }
    >
      {customers.length === 0 ? (
        <EmptyState>No deleted customers.</EmptyState>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Deleted</TableHead>
                {canWrite ? <TableHead className="w-28" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">{customer.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {customer.email || ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(customer.deleted_at)}
                  </TableCell>
                  {canWrite ? (
                    <TableCell>
                      <RestoreRecordButton
                        action={restoreCustomerFormAction.bind(
                          null,
                          orgSlug,
                          customer.id
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
