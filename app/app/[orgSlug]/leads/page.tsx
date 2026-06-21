import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FilterPill } from "@/components/filter-pill";
import { ListScreen, EmptyState, TableCard } from "@/components/list-screen";
import { AuthorisationError, hasPermission } from "@/lib/authorisation";
import { LEAD_STATUSES } from "@/lib/leads/schemas";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { listLeads } from "./actions";

type Lead = {
  id: string;
  name: string | null;
  email: string | null;
  status: string;
  created_at: string;
};

const STATUS_BADGES: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  new: "default",
  contacted: "secondary",
  qualified: "secondary",
  converted: "outline",
  rejected: "outline",
  spam: "destructive",
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { orgSlug } = await params;
  const { status } = await searchParams;
  const activeStatus = (LEAD_STATUSES as readonly string[]).includes(
    status ?? ""
  )
    ? status
    : undefined;

  const { membership } = await requireWorkspaceAccess(orgSlug);
  const canWrite = hasPermission(membership, "record.write");

  let leads: Lead[];
  try {
    leads = (await listLeads(
      orgSlug,
      activeStatus ? { status: activeStatus } : {}
    )) as Lead[];
  } catch (error) {
    // No leads entitlement: send the member back to the workspace overview
    // rather than showing a broken screen. Anything else is a real error.
    if (error instanceof AuthorisationError) {
      redirect(`/app/${orgSlug}`);
    }
    throw error;
  }

  return (
    <ListScreen
      title="Leads"
      description="Enquiries received by your organisation."
      action={
        canWrite ? (
          <Link
            href={`/app/${orgSlug}/leads/new`}
            className={buttonVariants({ size: "sm" })}
          >
            New lead
          </Link>
        ) : null
      }
      filters={
        <nav
          aria-label="Filter by status"
          className="flex flex-wrap items-center gap-1.5"
        >
          <FilterPill
            href={`/app/${orgSlug}/leads`}
            label="All"
            active={!activeStatus}
          />
          {LEAD_STATUSES.map((value) => (
            <FilterPill
              key={value}
              href={`/app/${orgSlug}/leads?status=${value}`}
              label={value.charAt(0).toUpperCase() + value.slice(1)}
              active={activeStatus === value}
            />
          ))}
        </nav>
      }
      toolbarEnd={
        <>
          <Link
            href={`/app/${orgSlug}/leads/forms`}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Web forms
          </Link>
          <Link
            href={`/app/${orgSlug}/leads/deleted`}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Deleted leads
          </Link>
        </>
      }
    >
      {leads.length === 0 ? (
        <EmptyState>
          {activeStatus
            ? `No ${activeStatus} leads.`
            : "No leads yet. New enquiries will appear here."}
        </EmptyState>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/app/${orgSlug}/leads/${lead.id}`}
                      className="block hover:underline"
                    >
                      {lead.name ?? "Unnamed"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {lead.email || ""}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGES[lead.status] ?? "secondary"}>
                      {lead.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(lead.created_at)}
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
