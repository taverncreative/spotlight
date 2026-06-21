import Link from "next/link";
import { JobForm } from "@/components/job-form";
import { FormScreen } from "@/components/form-screen";
import {
  AuthorisationError,
  requireModuleEnabled,
  requirePermission,
} from "@/lib/authorisation";
import { goneMessage, NO_PERMISSION_MESSAGE } from "@/lib/form-state";
import { loadJobFormOptions } from "@/lib/jobs/form-data";
import { seriesRuleInitial } from "@/lib/jobs/rule-display";
import { listOrganisationMembers } from "@/lib/members";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { getJob, getJobSeries } from "../../actions";
import type { SeriesRow } from "@/lib/jobs/series";
import { updateJobFormAction } from "../../form-actions";

type JobRecord = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  customer_id: string;
  site_id: string | null;
  scheduled_start: string | null;
  assigned_to: string | null;
  series_id: string | null;
};

// The edit form. Gated like the create page; the hidden Edit control is a
// courtesy, this page and the action enforce.
export default async function EditJobPage({
  params,
}: {
  params: Promise<{ orgSlug: string; jobId: string }>;
}) {
  const { orgSlug, jobId } = await params;

  let job: JobRecord | null;
  let options: Awaited<ReturnType<typeof loadJobFormOptions>>;
  let members: { id: string; name: string }[];
  let series: SeriesRow | null = null;
  try {
    const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
    await requireModuleEnabled(organisation, "jobs");
    requirePermission(membership, "record.write");
    job = (await getJob(orgSlug, { id: jobId })) as unknown as JobRecord | null;
    options = await loadJobFormOptions(organisation.id);
    members = await listOrganisationMembers(orgSlug);
    if (job?.series_id) {
      series = await getJobSeries(orgSlug, { id: job.series_id });
    }
  } catch (error) {
    if (error instanceof AuthorisationError) {
      return (
        <p role="alert" className="text-sm text-muted-foreground">
          {NO_PERMISSION_MESSAGE}
        </p>
      );
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

  return (
    <FormScreen
      backHref={`/app/${orgSlug}/jobs/${job.id}`}
      backLabel="Back to job"
      title="Edit job"
    >
      <JobForm
        action={updateJobFormAction.bind(null, orgSlug, job.id)}
        customers={options.customers}
        sites={options.sites}
        members={members}
        submitLabel="Save changes"
        initial={{
          title: job.title,
          description: job.description,
          customer_id: job.customer_id,
          site_id: job.site_id,
          scheduled_start: job.scheduled_start,
          assigned_to: job.assigned_to,
          status: job.status,
        }}
        cancelHref={`/app/${orgSlug}/jobs/${job.id}`}
        series={
          series ? { id: series.id, rule: seriesRuleInitial(series) } : null
        }
      />
    </FormScreen>
  );
}
