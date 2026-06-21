"use server";

import { requireWorkspaceAccess } from "@/lib/workspace";
import {
  requireModuleEnabled,
  requirePermission,
  type Capability,
} from "@/lib/authorisation";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";
import {
  jobCreateSchema,
  jobDeleteScopeSchema,
  jobIdSchema,
  jobListSchema,
  jobScheduleRangeSchema,
  jobScheduleSchema,
  jobSeriesCreateSchema,
  jobSeriesSplitSchema,
  jobSeriesUpdateSchema,
  jobStatusSchema,
  jobUpdateSchema,
} from "@/lib/jobs/schemas";
import {
  endColumns,
  horizonFrom,
  isLocked,
  regenerateFuture,
  SERIES_COLUMNS,
  slotTimes,
  stampOccurrences,
  type OccurrenceRow,
  type SeriesRow,
} from "@/lib/jobs/series";

// The Jobs server actions (Phase 2, Pass 1), following the recorded action shape
// (workspace access, jobs-module gate, role gate, Zod parse, organisation-scoped
// query). The customer/site/quote links are tenant-scoped composite foreign keys,
// so the database is the backstop; these actions give callers a calm null instead
// of a constraint error, and stand in for the assignee FK the schema omits (the
// assignee must be an active co-member, exactly as tasks validate it).

const JOB_COLUMNS =
  "id, title, description, status, customer_id, site_id, quote_id, scheduled_start, scheduled_end, assigned_to, series_id, series_slot, is_detached, created_at, updated_at";

type JobRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  customer_id: string;
  site_id: string | null;
  quote_id: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  assigned_to: string | null;
  series_id: string | null;
  series_slot: string | null;
  is_detached: boolean;
  created_at: string;
  updated_at: string;
};

async function gate(orgSlug: string, capability: Capability) {
  const context = await requireWorkspaceAccess(orgSlug);
  await requireModuleEnabled(context.organisation, "jobs");
  requirePermission(context.membership, capability);
  return context;
}

// Integrity check standing in for the absent assignee FK: the user must be an
// active member of this organisation (the same check tasks use).
async function assigneeInOrganisation(organisationId: string, userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("organisation_memberships")
    .select("user_id")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return data !== null;
}

// True when the customer exists, is active and belongs to the organisation.
async function customerInOrganisation(
  organisationId: string,
  customerId: string
) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("id", customerId)
    .is("deleted_at", null)
    .maybeSingle();
  return data !== null;
}

// True when the site exists, is active, belongs to the customer and is in the
// organisation (the same scoping quotes use for their site link).
async function siteBelongsToCustomer(
  organisationId: string,
  customerId: string,
  siteId: string
) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sites")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("customer_id", customerId)
    .eq("id", siteId)
    .is("deleted_at", null)
    .maybeSingle();
  return data !== null;
}

export async function listJobs(orgSlug: string, input: unknown = {}) {
  const { organisation } = await gate(orgSlug, "record.read");
  const filters = jobListSchema.parse(input);

  const supabase = await createClient();
  let query = supabase
    .from("jobs")
    .select(`${JOB_COLUMNS}, customers (name)`)
    .eq("organisation_id", organisation.id);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.assigned_to) query = query.eq("assigned_to", filters.assigned_to);

  const { data, error } = await query
    .order("scheduled_start", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

// The scheduler week view: the organisation's jobs whose scheduled_start falls
// in [from, to), optionally one assignee, with the customer name and ordered by
// start so each day's cards read top to bottom. The window is computed in UTC by
// the caller. Jobs with no scheduled_start never match a range, so they are
// surfaced separately by countUnscheduledJobs rather than silently dropped.
export async function listScheduledJobs(orgSlug: string, input: unknown) {
  const { organisation } = await gate(orgSlug, "record.read");
  const { from, to, assigned_to } = jobScheduleRangeSchema.parse(input);

  const supabase = await createClient();
  let query = supabase
    .from("jobs")
    .select(`${JOB_COLUMNS}, customers (name)`)
    .eq("organisation_id", organisation.id)
    .gte("scheduled_start", from)
    .lt("scheduled_start", to);
  if (assigned_to) query = query.eq("assigned_to", assigned_to);

  const { data, error } = await query.order("scheduled_start", {
    ascending: true,
  });
  if (error) throw new Error(error.message);
  return data;
}

// How many jobs have no scheduled_start: these cannot sit in any week, so the
// scheduler surfaces them as a rail linking to the list rather than hiding them.
export async function countUnscheduledJobs(orgSlug: string) {
  const { organisation } = await gate(orgSlug, "record.read");
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", organisation.id)
    .is("scheduled_start", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getJob(orgSlug: string, input: unknown) {
  const { organisation } = await gate(orgSlug, "record.read");
  const { id } = jobIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(
      `${JOB_COLUMNS}, customers (name), sites (name, address_line1, address_line2, town, county, postcode), quotes (quote_number, title)`
    )
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createJob(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const fields = jobCreateSchema.parse(input);

  if (!(await customerInOrganisation(organisation.id, fields.customer_id))) {
    return null;
  }
  if (
    fields.site_id &&
    !(await siteBelongsToCustomer(
      organisation.id,
      fields.customer_id,
      fields.site_id
    ))
  ) {
    return null;
  }
  if (
    fields.assigned_to &&
    !(await assigneeInOrganisation(organisation.id, fields.assigned_to))
  ) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .insert({
      title: fields.title,
      description: fields.description ?? null,
      customer_id: fields.customer_id,
      site_id: fields.site_id ?? null,
      quote_id: fields.quote_id ?? null,
      scheduled_start: fields.scheduled_start ?? null,
      assigned_to: fields.assigned_to ?? null,
      status: fields.status ?? "unscheduled",
      organisation_id: organisation.id,
      created_by: user.id,
      updated_by: user.id,
    })
    .select(JOB_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as JobRow;
}

export async function updateJob(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id, site_id, detach, ...fields } = jobUpdateSchema.parse(input);

  if (
    fields.customer_id &&
    !(await customerInOrganisation(organisation.id, fields.customer_id))
  ) {
    return null;
  }
  if (
    fields.assigned_to != null &&
    !(await assigneeInOrganisation(organisation.id, fields.assigned_to))
  ) {
    return null;
  }

  // The site is scoped to the job's customer, so resolve it against the current
  // job and the (possibly changed) customer, exactly as quotes do.
  const supabase = await createClient();
  const { data: current } = await supabase
    .from("jobs")
    .select("customer_id, site_id")
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .maybeSingle();
  if (!current) return null;

  const effectiveCustomerId = fields.customer_id ?? current.customer_id;
  const customerChanged =
    fields.customer_id !== undefined &&
    fields.customer_id !== current.customer_id;

  const changes: Record<string, unknown> = { updated_by: user.id };
  if (fields.title !== undefined) changes.title = fields.title;
  if (fields.description !== undefined) changes.description = fields.description;
  if (fields.customer_id !== undefined) changes.customer_id = fields.customer_id;
  if (fields.quote_id !== undefined) changes.quote_id = fields.quote_id;
  if (fields.scheduled_start !== undefined)
    changes.scheduled_start = fields.scheduled_start;
  if (fields.assigned_to !== undefined) changes.assigned_to = fields.assigned_to;
  if (fields.status !== undefined) changes.status = fields.status;
  // "This occurrence only": detach so a later series regeneration leaves it
  // alone. A one-off job never passes this.
  if (detach) changes.is_detached = true;

  if (site_id !== undefined) {
    if (site_id === null) {
      changes.site_id = null;
    } else if (
      await siteBelongsToCustomer(organisation.id, effectiveCustomerId, site_id)
    ) {
      changes.site_id = site_id;
    } else if (customerChanged) {
      // A stale site from the previous customer: drop it.
      changes.site_id = null;
    } else {
      // A site that does not belong to this customer, chosen deliberately.
      return null;
    }
  } else if (
    customerChanged &&
    current.site_id &&
    !(await siteBelongsToCustomer(
      organisation.id,
      effectiveCustomerId,
      current.site_id
    ))
  ) {
    // Customer changed without resubmitting the site, and the existing site is
    // not owned by the new customer: clear it.
    changes.site_id = null;
  }

  const { data, error } = await supabase
    .from("jobs")
    .update(changes)
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .select(JOB_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as JobRow | null;
}

// The focused schedule operation: set the time and assignee, and move an
// unscheduled job to scheduled. Re-scheduling an already-scheduled (or later)
// job just updates the time and assignee without changing its status.
export async function scheduleJob(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id, scheduled_start, assigned_to } = jobScheduleSchema.parse(input);

  if (
    assigned_to &&
    !(await assigneeInOrganisation(organisation.id, assigned_to))
  ) {
    return null;
  }

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("jobs")
    .select("status")
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .maybeSingle();
  if (!current) return null;

  const changes: Record<string, unknown> = {
    scheduled_start,
    assigned_to: assigned_to ?? null,
    updated_by: user.id,
  };
  if (current.status === "unscheduled") changes.status = "scheduled";

  const { data, error } = await supabase
    .from("jobs")
    .update(changes)
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .select(JOB_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as JobRow | null;
}

// Jobs follow tasks' free-status model (not the quotes constrained transition
// map): the quick control on the list and detail offers the sensible forward
// moves and cancel, but the action sets any of the five statuses, so reopening or
// correcting a status is possible without a special path.
export async function setJobStatus(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id, status } = jobStatusSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .update({ status, updated_by: user.id })
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .select(JOB_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as JobRow | null;
}

export async function deleteJob(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id } = jobIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .delete()
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (data) {
    await writeAuditLog({
      organisationId: organisation.id,
      actorUserId: user.id,
      action: "job.deleted",
      targetType: "job",
      targetId: data.id,
    });
  }
  return data;
}

// Create a job pre-filled from a quote and linked back to it, in the spirit of
// lead-to-customer conversion: the customer, site and a sensible title come from
// the quote, the job starts unscheduled, and quote_id records the origin. The
// quote is read organisation-scoped (a deleted or other-org quote yields a calm
// null). Returns the new job's id for the caller to redirect to.
export async function createJobFromQuote(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id: quoteId } = jobIdSchema.parse(input);

  const supabase = await createClient();
  const { data: quote } = await supabase
    .from("quotes")
    .select("id, quote_number, title, customer_id, site_id")
    .eq("organisation_id", organisation.id)
    .eq("id", quoteId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!quote) return null;

  const title = quote.title?.trim() || `Quote #${quote.quote_number}`;

  const { data, error } = await supabase
    .from("jobs")
    .insert({
      title,
      customer_id: quote.customer_id,
      site_id: quote.site_id ?? null,
      quote_id: quote.id,
      status: "unscheduled",
      organisation_id: organisation.id,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data as { id: string };
}

// Recurrence (the jobs recurrence pass). A series holds the repeat rule and the
// template; its occurrences are real job rows linked by series_id, generated to a
// horizon. The same jobs-module gate guards every series action. Cross-tenant or
// stale references return a calm null, as the one-off actions do.

// The id of the earliest occurrence of a series, for redirecting after a write.
async function firstOccurrenceId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organisationId: string,
  seriesId: string
) {
  const { data } = await supabase
    .from("jobs")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("series_id", seriesId)
    .order("scheduled_start", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

// Create a recurring job: insert the series, then stamp its occurrences to the
// horizon. The anchor is the first occurrence's scheduled_start.
export async function createJobSeries(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const fields = jobSeriesCreateSchema.parse(input);

  if (!(await customerInOrganisation(organisation.id, fields.customer_id))) {
    return null;
  }
  if (
    fields.site_id &&
    !(await siteBelongsToCustomer(
      organisation.id,
      fields.customer_id,
      fields.site_id
    ))
  ) {
    return null;
  }
  if (
    fields.assigned_to &&
    !(await assigneeInOrganisation(organisation.id, fields.assigned_to))
  ) {
    return null;
  }

  const end = endColumns(fields);
  const supabase = await createClient();
  const { data: series, error } = await supabase
    .from("job_series")
    .insert({
      organisation_id: organisation.id,
      frequency: fields.frequency,
      repeat_interval: fields.interval,
      anchor_start: fields.scheduled_start,
      repeat_until: end.repeat_until,
      max_occurrences: end.max_occurrences,
      title: fields.title,
      description: fields.description ?? null,
      customer_id: fields.customer_id,
      site_id: fields.site_id ?? null,
      assigned_to: fields.assigned_to ?? null,
      created_by: user.id,
      updated_by: user.id,
    })
    .select(SERIES_COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  const anchor = new Date(fields.scheduled_start);
  const horizon = horizonFrom(anchor, new Date());
  await stampOccurrences(supabase, {
    series: series as SeriesRow,
    userId: user.id,
    from: anchor,
    horizon,
    occupied: new Set(),
  });
  await supabase
    .from("job_series")
    .update({ generated_until: horizon.toISOString() })
    .eq("organisation_id", organisation.id)
    .eq("id", (series as SeriesRow).id);

  const jobId = await firstOccurrenceId(
    supabase,
    organisation.id,
    (series as SeriesRow).id
  );
  return { seriesId: (series as SeriesRow).id, jobId };
}

// Read a series (for the detail page's recurrence summary and the edit defaults).
export async function getJobSeries(orgSlug: string, input: unknown) {
  const { organisation } = await gate(orgSlug, "record.read");
  const { id } = jobIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_series")
    .select(SERIES_COLUMNS)
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as SeriesRow | null;
}

// "Entire series" edit: change the rule and template, then regenerate the future
// un-locked occurrences, leaving past, completed, cancelled and detached ones
// intact. An optional scheduled_start re-times the series: its time of day is
// applied to the anchor's date (the anchor date is unchanged), so the future
// un-locked occurrences shift to the new time, keeping their dates and cadence.
export async function updateJobSeries(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const fields = jobSeriesUpdateSchema.parse(input);

  if (!(await customerInOrganisation(organisation.id, fields.customer_id))) {
    return null;
  }
  if (
    fields.site_id &&
    !(await siteBelongsToCustomer(
      organisation.id,
      fields.customer_id,
      fields.site_id
    ))
  ) {
    return null;
  }
  if (
    fields.assigned_to &&
    !(await assigneeInOrganisation(organisation.id, fields.assigned_to))
  ) {
    return null;
  }

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("job_series")
    .select(SERIES_COLUMNS)
    .eq("organisation_id", organisation.id)
    .eq("id", fields.series_id)
    .maybeSingle();
  if (!current) return null;

  // Re-time when a scheduled_start is supplied: take its time of day and keep the
  // anchor's date, so the dates and cadence are unchanged and only the time
  // shifts. Absent leaves the anchor (and so the time) as it was.
  let anchorStart = (current as SeriesRow).anchor_start;
  if (fields.scheduled_start) {
    const anchorDate = new Date(anchorStart);
    const newTime = new Date(fields.scheduled_start);
    anchorStart = new Date(
      Date.UTC(
        anchorDate.getUTCFullYear(),
        anchorDate.getUTCMonth(),
        anchorDate.getUTCDate(),
        newTime.getUTCHours(),
        newTime.getUTCMinutes(),
        newTime.getUTCSeconds(),
        newTime.getUTCMilliseconds()
      )
    ).toISOString();
  }

  const end = endColumns(fields);
  const { data: series, error } = await supabase
    .from("job_series")
    .update({
      frequency: fields.frequency,
      repeat_interval: fields.interval,
      anchor_start: anchorStart,
      repeat_until: end.repeat_until,
      max_occurrences: end.max_occurrences,
      title: fields.title,
      description: fields.description ?? null,
      customer_id: fields.customer_id,
      site_id: fields.site_id ?? null,
      assigned_to: fields.assigned_to ?? null,
      updated_by: user.id,
    })
    .eq("organisation_id", organisation.id)
    .eq("id", fields.series_id)
    .select(SERIES_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!series) return null;

  const now = new Date();
  const horizon = horizonFrom(new Date((series as SeriesRow).anchor_start), now);
  await regenerateFuture(supabase, {
    series: series as SeriesRow,
    userId: user.id,
    boundary: now,
    horizon,
  });
  await supabase
    .from("job_series")
    .update({ generated_until: horizon.toISOString() })
    .eq("organisation_id", organisation.id)
    .eq("id", fields.series_id);

  return { seriesId: fields.series_id };
}

// "This and all following" split: end the original series just before the chosen
// occurrence's slot, start a new series there with the new rule/template, and
// move this-and-future occurrences under it. Everything before the split is
// untouched. Returns the new series and its first occurrence.
export async function splitJobSeries(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const fields = jobSeriesSplitSchema.parse(input);

  if (!(await customerInOrganisation(organisation.id, fields.customer_id))) {
    return null;
  }
  if (
    fields.site_id &&
    !(await siteBelongsToCustomer(
      organisation.id,
      fields.customer_id,
      fields.site_id
    ))
  ) {
    return null;
  }
  if (
    fields.assigned_to &&
    !(await assigneeInOrganisation(organisation.id, fields.assigned_to))
  ) {
    return null;
  }

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, series_id, series_slot")
    .eq("organisation_id", organisation.id)
    .eq("id", fields.id)
    .maybeSingle();
  if (!job || !job.series_id || !job.series_slot) return null;

  const { data: seriesA } = await supabase
    .from("job_series")
    .select(SERIES_COLUMNS)
    .eq("organisation_id", organisation.id)
    .eq("id", job.series_id)
    .maybeSingle();
  if (!seriesA) return null;

  const splitSlot = job.series_slot as string;
  const splitAt = new Date(splitSlot);
  const end = endColumns(fields);

  // 1. New series B, anchored at the split slot, with the new rule/template.
  const { data: seriesB, error } = await supabase
    .from("job_series")
    .insert({
      organisation_id: organisation.id,
      frequency: fields.frequency,
      repeat_interval: fields.interval,
      anchor_start: splitSlot,
      repeat_until: end.repeat_until,
      max_occurrences: end.max_occurrences,
      title: fields.title,
      description: fields.description ?? null,
      customer_id: fields.customer_id,
      site_id: fields.site_id ?? null,
      assigned_to: fields.assigned_to ?? null,
      created_by: user.id,
      updated_by: user.id,
    })
    .select(SERIES_COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  // 2. Cap series A to end just before the split (normalise onto repeat_until).
  await supabase
    .from("job_series")
    .update({
      repeat_until: splitSlot,
      max_occurrences: null,
      generated_until: splitSlot,
      updated_by: user.id,
    })
    .eq("organisation_id", organisation.id)
    .eq("id", (seriesA as SeriesRow).id);

  // 3. This-and-future occurrences: delete the un-locked (regenerated under B),
  // reassign the locked (preserved exceptions move to B).
  const { data: fromSplit } = await supabase
    .from("jobs")
    .select("id, status, scheduled_start, series_slot, is_detached")
    .eq("organisation_id", organisation.id)
    .eq("series_id", (seriesA as SeriesRow).id)
    .gte("series_slot", splitSlot);
  const atOrAfter = (fromSplit ?? []) as OccurrenceRow[];
  const lockedFuture = atOrAfter.filter((j) => isLocked(j));
  const unlockedFuture = atOrAfter.filter((j) => !isLocked(j));

  if (unlockedFuture.length) {
    const del = await supabase
      .from("jobs")
      .delete()
      .in(
        "id",
        unlockedFuture.map((j) => j.id)
      );
    if (del.error) throw new Error(del.error.message);
  }
  if (lockedFuture.length) {
    const move = await supabase
      .from("jobs")
      .update({ series_id: (seriesB as SeriesRow).id, updated_by: user.id })
      .in(
        "id",
        lockedFuture.map((j) => j.id)
      );
    if (move.error) throw new Error(move.error.message);
  }

  // 4. Generate B from the split slot, skipping slots the moved locked ones hold.
  const horizon = horizonFrom(splitAt, new Date());
  await stampOccurrences(supabase, {
    series: seriesB as SeriesRow,
    userId: user.id,
    from: splitAt,
    horizon,
    occupied: slotTimes(lockedFuture),
  });
  await supabase
    .from("job_series")
    .update({ generated_until: horizon.toISOString() })
    .eq("organisation_id", organisation.id)
    .eq("id", (seriesB as SeriesRow).id);

  const jobId = await firstOccurrenceId(
    supabase,
    organisation.id,
    (seriesB as SeriesRow).id
  );
  return { seriesId: (seriesB as SeriesRow).id, jobId };
}

// Skip a single occurrence: cancel and detach it, so it shows as cancelled,
// survives a series regeneration, and its slot is never regenerated.
export async function skipJobOccurrence(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id } = jobIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .update({ status: "cancelled", is_detached: true, updated_by: user.id })
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .select(JOB_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as JobRow | null;
}

// Delete with a series scope:
//   occurrence  delete just this job; if it belongs to a series, record its slot
//               as skipped so a later regeneration does not resurrect it.
//   following   delete this and all following un-locked occurrences and cap the
//               series to end before this slot; everything before is untouched.
//   series      delete every future un-locked occurrence and the series itself
//               (remaining locked/past occurrences detach via the FK).
export async function deleteJobScoped(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id, scope } = jobDeleteScopeSchema.parse(input);

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, series_id, series_slot")
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .maybeSingle();
  if (!job) return null;

  // A one-off job, or "this occurrence only".
  if (!job.series_id || scope === "occurrence") {
    if (job.series_id && job.series_slot) {
      const { data: s } = await supabase
        .from("job_series")
        .select("skipped_slots")
        .eq("organisation_id", organisation.id)
        .eq("id", job.series_id)
        .maybeSingle();
      if (s) {
        const next = Array.from(
          new Set([...(s.skipped_slots ?? []), job.series_slot as string])
        );
        await supabase
          .from("job_series")
          .update({ skipped_slots: next, updated_by: user.id })
          .eq("organisation_id", organisation.id)
          .eq("id", job.series_id);
      }
    }
    const { data: deleted, error } = await supabase
      .from("jobs")
      .delete()
      .eq("organisation_id", organisation.id)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (deleted) {
      await writeAuditLog({
        organisationId: organisation.id,
        actorUserId: user.id,
        action: "job.deleted",
        targetType: "job",
        targetId: deleted.id,
      });
    }
    return deleted;
  }

  const { data: series } = await supabase
    .from("job_series")
    .select("id")
    .eq("organisation_id", organisation.id)
    .eq("id", job.series_id)
    .maybeSingle();
  if (!series) return null;

  if (scope === "following") {
    const splitSlot = job.series_slot as string;
    const { data: after } = await supabase
      .from("jobs")
      .select("id, status, scheduled_start, series_slot, is_detached")
      .eq("organisation_id", organisation.id)
      .eq("series_id", series.id)
      .gte("series_slot", splitSlot);
    const unlocked = ((after ?? []) as OccurrenceRow[]).filter(
      (j) => !isLocked(j)
    );
    if (unlocked.length) {
      const del = await supabase
        .from("jobs")
        .delete()
        .in(
          "id",
          unlocked.map((j) => j.id)
        );
      if (del.error) throw new Error(del.error.message);
    }
    await supabase
      .from("job_series")
      .update({
        repeat_until: splitSlot,
        max_occurrences: null,
        generated_until: splitSlot,
        updated_by: user.id,
      })
      .eq("organisation_id", organisation.id)
      .eq("id", series.id);
    await writeAuditLog({
      organisationId: organisation.id,
      actorUserId: user.id,
      action: "job_series.truncated",
      targetType: "job_series",
      targetId: series.id,
    });
    return { id: series.id };
  }

  // scope === "series": remove future un-locked occurrences, then the series.
  const now = new Date();
  const { data: all } = await supabase
    .from("jobs")
    .select("id, status, scheduled_start, series_slot, is_detached")
    .eq("organisation_id", organisation.id)
    .eq("series_id", series.id);
  const unlockedFuture = ((all ?? []) as OccurrenceRow[]).filter(
    (j) =>
      !isLocked(j) &&
      (j.scheduled_start == null ||
        new Date(j.scheduled_start).getTime() >= now.getTime())
  );
  if (unlockedFuture.length) {
    const del = await supabase
      .from("jobs")
      .delete()
      .in(
        "id",
        unlockedFuture.map((j) => j.id)
      );
    if (del.error) throw new Error(del.error.message);
  }
  const { data: deletedSeries, error } = await supabase
    .from("job_series")
    .delete()
    .eq("organisation_id", organisation.id)
    .eq("id", series.id)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (deletedSeries) {
    await writeAuditLog({
      organisationId: organisation.id,
      actorUserId: user.id,
      action: "job_series.deleted",
      targetType: "job_series",
      targetId: deletedSeries.id,
    });
  }
  return deletedSeries;
}
