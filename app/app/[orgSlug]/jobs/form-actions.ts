"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  formStateFromError,
  goneMessage,
  type FormState,
} from "@/lib/form-state";
import {
  createJob,
  createJobFromQuote,
  createJobSeries,
  deleteJobScoped,
  scheduleJob,
  setJobStatus,
  skipJobOccurrence,
  splitJobSeries,
  updateJob,
  updateJobSeries,
} from "./actions";
import { JOB_DELETE_SCOPES } from "@/lib/jobs/schemas";

// Form-facing wrappers around the jobs actions: same gates and validation, but
// denials and bad input come back as form state for useActionState instead of
// throwing at the form. Create and edit land on the job's detail; the inline
// status, schedule and delete controls revalidate in place.

const JOB_GONE = goneMessage("job");

// A datetime-local input gives "YYYY-MM-DDTHH:mm"; the schema wants an ISO
// datetime with an offset. Empty stays empty (the schema turns it into null).
// The chosen wall-clock time is treated as UTC, the same convention the tasks
// due date uses, so the stored time is deterministic.
function scheduleFromForm(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}:00.000Z`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed))
    return `${trimmed}.000Z`;
  return trimmed;
}

function jobFieldsFromForm(formData: FormData) {
  return {
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    customer_id: String(formData.get("customer_id") ?? ""),
    site_id: String(formData.get("site_id") ?? ""),
    scheduled_start: scheduleFromForm(String(formData.get("scheduled_start") ?? "")),
    assigned_to: String(formData.get("assigned_to") ?? ""),
  };
}

// The series template plus repeat rule, shared by create-with-repeat, the
// whole-series edit and the split. interval and occurrence_count are coerced by
// the schemas, so the raw strings are passed straight through.
function seriesInputFromForm(formData: FormData) {
  return {
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    customer_id: String(formData.get("customer_id") ?? ""),
    site_id: String(formData.get("site_id") ?? ""),
    assigned_to: String(formData.get("assigned_to") ?? ""),
    frequency: String(formData.get("frequency") ?? ""),
    interval: String(formData.get("interval") ?? "1"),
    end_kind: String(formData.get("end_kind") ?? "never"),
    until_date: String(formData.get("until_date") ?? ""),
    occurrence_count: String(formData.get("occurrence_count") ?? ""),
  };
}

function scopeFromForm(formData: FormData) {
  const raw = String(formData.get("scope") ?? "occurrence");
  return (JOB_DELETE_SCOPES as readonly string[]).includes(raw)
    ? (raw as (typeof JOB_DELETE_SCOPES)[number])
    : "occurrence";
}

export async function createJobFormAction(
  orgSlug: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  // "Repeats" on creates a series and stamps its occurrences; otherwise a
  // seriesless one-off, exactly as before.
  if (formData.get("repeat") != null) {
    let created: { jobId: string | null } | null;
    try {
      created = (await createJobSeries(orgSlug, {
        ...seriesInputFromForm(formData),
        scheduled_start: scheduleFromForm(
          String(formData.get("scheduled_start") ?? "")
        ),
      })) as { jobId: string | null } | null;
    } catch (error) {
      return formStateFromError(error);
    }
    if (!created) return { formError: JOB_GONE };
    redirect(
      created.jobId
        ? `/app/${orgSlug}/jobs/${created.jobId}`
        : `/app/${orgSlug}/jobs`
    );
  }

  let created: { id: string } | null;
  try {
    const input: Record<string, unknown> = jobFieldsFromForm(formData);
    if (formData.has("status")) input.status = String(formData.get("status"));
    created = (await createJob(orgSlug, input)) as { id: string } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!created) return { formError: JOB_GONE };
  redirect(`/app/${orgSlug}/jobs/${created.id}`);
}

export async function updateJobFormAction(
  orgSlug: string,
  jobId: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const scope = formData.get("scope");

  // "This and all following": split the series at this occurrence.
  if (scope === "following") {
    let result: { jobId: string | null } | null;
    try {
      result = (await splitJobSeries(orgSlug, {
        id: jobId,
        ...seriesInputFromForm(formData),
      })) as { jobId: string | null } | null;
    } catch (error) {
      return formStateFromError(error);
    }
    if (!result) return { formError: JOB_GONE };
    redirect(`/app/${orgSlug}/jobs/${result.jobId ?? jobId}`);
  }

  // "The entire series": change the rule/template, re-time to the submitted
  // schedule time, and regenerate the future.
  if (scope === "series") {
    let result: unknown;
    try {
      result = await updateJobSeries(orgSlug, {
        series_id: String(formData.get("series_id") ?? ""),
        ...seriesInputFromForm(formData),
        scheduled_start: scheduleFromForm(
          String(formData.get("scheduled_start") ?? "")
        ),
      });
    } catch (error) {
      return formStateFromError(error);
    }
    if (!result) return { formError: JOB_GONE };
    redirect(`/app/${orgSlug}/jobs/${jobId}`);
  }

  // A one-off edit, or "this occurrence only" (which detaches).
  let updated: unknown;
  try {
    const input: Record<string, unknown> = {
      id: jobId,
      ...jobFieldsFromForm(formData),
    };
    if (formData.has("status")) input.status = String(formData.get("status"));
    if (scope === "occurrence") input.detach = true;
    updated = await updateJob(orgSlug, input);
  } catch (error) {
    return formStateFromError(error);
  }
  if (!updated) return { formError: JOB_GONE };
  redirect(`/app/${orgSlug}/jobs/${jobId}`);
}

export async function scheduleJobFormAction(
  orgSlug: string,
  jobId: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    const scheduled = await scheduleJob(orgSlug, {
      id: jobId,
      scheduled_start: scheduleFromForm(
        String(formData.get("scheduled_start") ?? "")
      ),
      assigned_to: String(formData.get("assigned_to") ?? ""),
    });
    if (!scheduled) return { formError: JOB_GONE };
  } catch (error) {
    return formStateFromError(error);
  }
  revalidatePath(`/app/${orgSlug}/jobs/${jobId}`);
  return null;
}

// status changes happen on the list and on the detail; the caller binds the path
// to revalidate so the right screen refreshes in place.
export async function setJobStatusFormAction(
  orgSlug: string,
  jobId: string,
  revalidateHref: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    const updated = await setJobStatus(orgSlug, {
      id: jobId,
      status: String(formData.get("status") ?? ""),
    });
    if (!updated) return { formError: JOB_GONE };
  } catch (error) {
    return formStateFromError(error);
  }
  revalidatePath(revalidateHref);
  return null;
}

// Delete from the list: the row disappears in place. A series occurrence deletes
// with the default "occurrence" scope (recording its slot so a later
// regeneration does not resurrect it); a one-off just deletes.
export async function deleteJobFormAction(
  orgSlug: string,
  jobId: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    const deleted = await deleteJobScoped(orgSlug, {
      id: jobId,
      scope: scopeFromForm(formData),
    });
    if (!deleted) return { formError: JOB_GONE };
  } catch (error) {
    return formStateFromError(error);
  }
  revalidatePath(`/app/${orgSlug}/jobs`);
  return null;
}

// Delete from the detail: the chosen occurrence (and, for the series scopes,
// more) is gone, so return to the list. The three-way dialog submits the scope.
export async function deleteJobRedirectFormAction(
  orgSlug: string,
  jobId: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    const deleted = await deleteJobScoped(orgSlug, {
      id: jobId,
      scope: scopeFromForm(formData),
    });
    if (!deleted) return { formError: JOB_GONE };
  } catch (error) {
    return formStateFromError(error);
  }
  redirect(`/app/${orgSlug}/jobs`);
}

// Skip a single occurrence (cancel and detach it) from the detail, in place.
export async function skipJobFormAction(
  orgSlug: string,
  jobId: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  try {
    const skipped = await skipJobOccurrence(orgSlug, { id: jobId });
    if (!skipped) return { formError: JOB_GONE };
  } catch (error) {
    return formStateFromError(error);
  }
  revalidatePath(`/app/${orgSlug}/jobs/${jobId}`);
  return null;
}

// Create a job from a quote (on the quote detail), then land on the new job.
export async function createJobFromQuoteFormAction(
  orgSlug: string,
  quoteId: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  let created: { id: string } | null;
  try {
    created = (await createJobFromQuote(orgSlug, { id: quoteId })) as
      | { id: string }
      | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!created) return { formError: goneMessage("quote") };
  redirect(`/app/${orgSlug}/jobs/${created.id}`);
}
