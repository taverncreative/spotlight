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
import { listDeletedLeads } from "../actions";
import { restoreLeadFormAction } from "../form-actions";

type DeletedLead = {
  id: string;
  name: string | null;
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

export default async function DeletedLeadsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { membership } = await requireWorkspaceAccess(orgSlug);
  const canWrite = hasPermission(membership, "record.write");

  let leads: DeletedLead[];
  try {
    leads = (await listDeletedLeads(orgSlug)) as DeletedLead[];
  } catch (error) {
    if (error instanceof AuthorisationError) {
      redirect(`/app/${orgSlug}`);
    }
    throw error;
  }

  return (
    <ListScreen
      title="Deleted leads"
      description="Deleted leads can be restored at any time."
      toolbarEnd={
        <Link
          href={`/app/${orgSlug}/leads`}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Back to leads
        </Link>
      }
    >
      {leads.length === 0 ? (
        <EmptyState>No deleted leads.</EmptyState>
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
              {leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="font-medium">
                    {lead.name ?? "Unnamed"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {lead.email || ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(lead.deleted_at)}
                  </TableCell>
                  {canWrite ? (
                    <TableCell>
                      <RestoreRecordButton
                        action={restoreLeadFormAction.bind(
                          null,
                          orgSlug,
                          lead.id
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
