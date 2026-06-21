import Link from "next/link";
import { redirect } from "next/navigation";
import { Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  RecordDetailShell,
  DetailFields,
  DetailField,
} from "@/components/record-detail";
import { SectionCard } from "@/components/section-card";
import { JobStatusControl } from "@/components/job-status-control";
import { JobDeleteDialog } from "@/components/job-delete-dialog";
import { JobScheduleForm } from "@/components/job-schedule-form";
import { JobSkipButton } from "@/components/job-skip-button";
import { NotesSection } from "@/components/notes-section";
import { FilesSection } from "@/components/files-section";
import { AuthorisationError, hasPermission } from "@/lib/authorisation";
import { statusBadge, statusLabel } from "@/lib/jobs/status";
import { describeSeries } from "@/lib/jobs/rule-display";
import type { SeriesRow } from "@/lib/jobs/series";
import { goneMessage } from "@/lib/form-state";
import { siteAddressSummary, type QuoteSite } from "@/lib/quotes/site-summary";
import { listOrganisationMembers } from "@/lib/members";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { getJob, getJobSeries } from "../actions";
import {
  deleteJobRedirectFormAction,
  scheduleJobFormAction,
  setJobStatusFormAction,
  skipJobFormAction,
} from "../form-actions";

type JobDetail = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  customer_id: string;
  site_id: string | null;
  quote_id: string | null;
  scheduled_start: string | null;
  assigned_to: string | null;
  series_id: string | null;
  is_detached: boolean;
  created_at: string;
  customers: { name: string } | null;
  sites: QuoteSite | null;
  quotes: { quote_number: number; title: string | null } | null;
};

type Member = { id: string; name: string };

const SCHEDULABLE = new Set(["unscheduled", "scheduled", "in_progress"]);

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; jobId: string }>;
  searchParams: Promise<{ editNote?: string }>;
}) {
  const { orgSlug, jobId } = await params;
  const { editNote } = await searchParams;
  const { membership } = await requireWorkspaceAccess(orgSlug);
  const canWrite = hasPermission(membership, "record.write");

  let job: JobDetail | null;
  let members: Member[];
  let series: SeriesRow | null = null;
  try {
    job = (await getJob(orgSlug, { id: jobId })) as unknown as JobDetail | null;
    members = await listOrganisationMembers(orgSlug);
    if (job?.series_id) {
      series = await getJobSeries(orgSlug, { id: job.series_id });
    }
  } catch (error) {
    if (error instanceof AuthorisationError) {
      redirect(`/app/${orgSlug}`);
    }
    throw error;
  }

  if (!job) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{goneMessage("job")}</p>
        <Link
          href={`/app/${orgSlug}/jobs`}
          className="text-sm underline underline-offset-4"
        >
          Back to jobs
        </Link>
      </div>
    );
  }

  const detailHref = `/app/${orgSlug}/jobs/${job.id}`;
  const assigneeName = job.assigned_to
    ? members.find((m) => m.id === job.assigned_to)?.name ?? "Unknown"
    : null;
  const siteSummary = job.sites ? siteAddressSummary(job.sites) : "";
  const showSchedule = canWrite && SCHEDULABLE.has(job.status);
  const recurrenceSummary = series ? describeSeries(series) : null;
  const canSkip = canWrite && !!job.series_id && job.status !== "cancelled";

  return (
    <RecordDetailShell
      title={job.title}
      status={
        <Badge variant={statusBadge(job.status)}>{statusLabel(job.status)}</Badge>
      }
      meta={
        <div className="space-y-0.5 text-sm text-muted-foreground">
          <p>{job.customers?.name ?? "Unknown customer"}</p>
          {job.sites ? (
            <p>
              Site: {job.sites.name}
              {siteSummary ? `, ${siteSummary}` : ""}
            </p>
          ) : null}
          {recurrenceSummary ? (
            <p className="flex items-center gap-1.5">
              <Repeat className="size-3.5" aria-hidden="true" />
              <span>Repeats: {recurrenceSummary}</span>
              {job.is_detached ? (
                <span className="text-xs">(edited occurrence)</span>
              ) : null}
            </p>
          ) : null}
        </div>
      }
      actions={
        canWrite ? (
          <>
            <JobStatusControl
              action={setJobStatusFormAction.bind(
                null,
                orgSlug,
                job.id,
                detailHref
              )}
              status={job.status}
            />
            <Link
              href={`/app/${orgSlug}/jobs/${job.id}/edit`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Edit
            </Link>
            <JobDeleteDialog
              action={deleteJobRedirectFormAction.bind(null, orgSlug, job.id)}
              jobTitle={job.title}
              series={!!job.series_id}
            />
          </>
        ) : undefined
      }
      fields={
        <>
          <DetailFields>
            <DetailField
              label="Scheduled"
              value={
                job.scheduled_start ? formatDateTime(job.scheduled_start) : null
              }
            />
            <DetailField label="Assignee" value={assigneeName} />
            <DetailField label="Created" value={formatDate(job.created_at)} />
          </DetailFields>
          {job.quote_id && job.quotes ? (
            <p className="text-sm">
              <span className="text-muted-foreground">From </span>
              <Link
                href={`/app/${orgSlug}/quotes/${job.quote_id}`}
                className="font-medium underline underline-offset-4"
              >
                Quote #{job.quotes.quote_number}
                {job.quotes.title ? ` ${job.quotes.title}` : ""}
              </Link>
            </p>
          ) : null}
          {job.description ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {job.description}
            </p>
          ) : null}
        </>
      }
      backHref={`/app/${orgSlug}/jobs`}
      backLabel="Back to jobs"
    >
      {showSchedule ? (
        <SectionCard title="Schedule">
          <JobScheduleForm
            action={scheduleJobFormAction.bind(null, orgSlug, job.id)}
            members={members}
            scheduledStart={job.scheduled_start}
            assignedTo={job.assigned_to}
          />
        </SectionCard>
      ) : null}

      {job.series_id ? (
        <SectionCard title="Recurrence">
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2">
              <Repeat className="size-4 shrink-0" aria-hidden="true" />
              <span className="font-medium">{recurrenceSummary}</span>
            </p>
            <p className="text-muted-foreground">
              This job is one occurrence of a series. Editing or deleting it
              offers three scopes: this occurrence only, this and all following,
              or the entire series.
            </p>
            {canSkip ? (
              <JobSkipButton
                action={skipJobFormAction.bind(null, orgSlug, job.id)}
              />
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      <NotesSection
        orgSlug={orgSlug}
        recordType="job"
        recordId={job.id}
        detailHref={detailHref}
        editNoteId={editNote}
      />

      <FilesSection
        orgSlug={orgSlug}
        recordType="job"
        recordId={job.id}
        detailHref={detailHref}
      />
    </RecordDetailShell>
  );
}
