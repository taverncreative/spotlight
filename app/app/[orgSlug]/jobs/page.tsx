import Link from "next/link";
import { redirect } from "next/navigation";
import { Repeat } from "lucide-react";
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
import { JobStatusControl } from "@/components/job-status-control";
import { JobDeleteDialog } from "@/components/job-delete-dialog";
import { JobsViewToggle } from "@/components/jobs-view-toggle";
import { AuthorisationError, hasPermission } from "@/lib/authorisation";
import { JOB_STATUSES } from "@/lib/jobs/schemas";
import { STATUS_LABELS, statusBadge, statusLabel } from "@/lib/jobs/status";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { listOrganisationMembers } from "@/lib/members";
import { listJobs } from "./actions";
import { deleteJobFormAction, setJobStatusFormAction } from "./form-actions";

type Job = {
  id: string;
  title: string;
  status: string;
  scheduled_start: string | null;
  assigned_to: string | null;
  series_id: string | null;
  customers: { name: string } | null;
};

type Member = { id: string; name: string };

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export default async function JobsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ status?: string; assignee?: string }>;
}) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const { user, membership } = await requireWorkspaceAccess(orgSlug);
  const canWrite = hasPermission(membership, "record.write");

  const activeStatus = (JOB_STATUSES as readonly string[]).includes(
    sp.status ?? ""
  )
    ? sp.status
    : undefined;

  let jobs: Job[];
  let members: Member[];
  let activeAssignee: string | undefined;
  try {
    members = await listOrganisationMembers(orgSlug);
    activeAssignee =
      sp.assignee === "me" || members.some((m) => m.id === sp.assignee)
        ? sp.assignee
        : undefined;

    const filter: Record<string, unknown> = {};
    if (activeStatus) filter.status = activeStatus;
    if (activeAssignee === "me") filter.assigned_to = user.id;
    else if (activeAssignee) filter.assigned_to = activeAssignee;

    jobs = (await listJobs(orgSlug, filter)) as unknown as Job[];
  } catch (error) {
    // No jobs entitlement: send the member back to the workspace overview
    // rather than showing a broken screen. Anything else is a real error.
    if (error instanceof AuthorisationError) {
      redirect(`/app/${orgSlug}`);
    }
    throw error;
  }

  const nameById = new Map(members.map((m) => [m.id, m.name]));

  const current = { status: activeStatus, assignee: activeAssignee };
  const hrefWith = (overrides: Record<string, string | undefined>) => {
    const merged = { ...current, ...overrides };
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) query.set(key, value);
    }
    const qs = query.toString();
    return qs ? `/app/${orgSlug}/jobs?${qs}` : `/app/${orgSlug}/jobs`;
  };

  return (
    <ListScreen
      title="Jobs"
      description="Scheduled work for your organisation's customers."
      action={
        canWrite ? (
          <Link
            href={`/app/${orgSlug}/jobs/new`}
            className={buttonVariants({ size: "sm" })}
          >
            New job
          </Link>
        ) : null
      }
      toolbarEnd={<JobsViewToggle orgSlug={orgSlug} active="list" />}
      filters={
        <div className="w-full space-y-1.5">
          <nav aria-label="Filter by status" className="flex flex-wrap gap-1">
            <FilterPill
              href={hrefWith({ status: undefined })}
              label="All"
              active={!activeStatus}
            />
            {JOB_STATUSES.map((value) => (
              <FilterPill
                key={value}
                href={hrefWith({ status: value })}
                label={STATUS_LABELS[value]}
                active={activeStatus === value}
              />
            ))}
          </nav>

          <nav aria-label="Filter by assignee" className="flex flex-wrap gap-1">
            <FilterPill
              href={hrefWith({ assignee: undefined })}
              label="All assignees"
              active={!activeAssignee}
            />
            <FilterPill
              href={hrefWith({ assignee: "me" })}
              label="Me"
              active={activeAssignee === "me"}
            />
            {members.map((member) => (
              <FilterPill
                key={member.id}
                href={hrefWith({ assignee: member.id })}
                label={member.name}
                active={activeAssignee === member.id}
              />
            ))}
          </nav>
        </div>
      }
    >
      {jobs.length === 0 ? (
        <EmptyState>No jobs match these filters.</EmptyState>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Status</TableHead>
                {canWrite ? <TableHead>Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/app/${orgSlug}/jobs/${job.id}`}
                      className="flex items-center gap-1.5 hover:underline"
                    >
                      {job.series_id ? (
                        <Repeat
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-label="Recurring"
                        />
                      ) : null}
                      {job.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {job.customers?.name ?? "Unknown"}
                  </TableCell>
                  <TableCell>
                    {job.scheduled_start ? (
                      formatDateTime(job.scheduled_start)
                    ) : (
                      <span className="text-muted-foreground">Unscheduled</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {job.assigned_to
                      ? nameById.get(job.assigned_to) ?? "Unknown"
                      : "Unassigned"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadge(job.status)}>
                      {statusLabel(job.status)}
                    </Badge>
                  </TableCell>
                  {canWrite ? (
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <JobStatusControl
                          action={setJobStatusFormAction.bind(
                            null,
                            orgSlug,
                            job.id,
                            `/app/${orgSlug}/jobs`
                          )}
                          status={job.status}
                        />
                        <Link
                          href={`/app/${orgSlug}/jobs/${job.id}/edit`}
                          className={buttonVariants({
                            variant: "outline",
                            size: "sm",
                          })}
                        >
                          Edit
                        </Link>
                        <JobDeleteDialog
                          action={deleteJobFormAction.bind(
                            null,
                            orgSlug,
                            job.id
                          )}
                          jobTitle={job.title}
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
