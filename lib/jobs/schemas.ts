import { z } from "zod";
import { RECURRENCE_FREQUENCIES } from "@/lib/jobs/recurrence";

// Jobs schemas (Phase 2, Pass 1). Empty optional fields normalise to null at the
// schema boundary, the same pattern as leads, customers, tasks and quotes: one
// representation for "no value", and absent fields stay undefined (meaning "do
// not change" on update). The composite-FK links (customer/site/quote) are
// validated for shape here; that the records actually exist in the organisation,
// and that the site belongs to the customer, are application-layer checks in the
// actions, with the tenant-scoped foreign keys as the database backstop.

const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

export const JOB_STATUSES = [
  "unscheduled",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

const optionalText = z.preprocess(
  emptyToNull,
  z.string().trim().max(2000).nullish()
);

// scheduled_start accepts an ISO datetime with an offset (the form-action turns a
// datetime-local value into one). Empty -> null.
const optionalSchedule = z.preprocess(
  emptyToNull,
  z.iso.datetime({ offset: true }).nullish()
);

const optionalAssignee = z.preprocess(emptyToNull, z.uuid().nullish());
const optionalSite = z.preprocess(emptyToNull, z.uuid().nullish());
const optionalQuote = z.preprocess(emptyToNull, z.uuid().nullish());

export const jobCreateSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: optionalText,
  customer_id: z.uuid("Choose a customer"),
  site_id: optionalSite,
  quote_id: optionalQuote,
  scheduled_start: optionalSchedule,
  assigned_to: optionalAssignee,
  // status is optional on create; absent leaves the database default of
  // 'unscheduled'. The form offers it.
  status: z.enum(JOB_STATUSES).optional(),
});

export const jobUpdateSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1, "Title is required").max(200).optional(),
  description: optionalText,
  customer_id: z.uuid().optional(),
  site_id: optionalSite,
  quote_id: optionalQuote,
  scheduled_start: optionalSchedule,
  assigned_to: optionalAssignee,
  status: z.enum(JOB_STATUSES).optional(),
  // "This occurrence only" edit of a series job sets this, locking the occurrence
  // so a later series regeneration leaves it alone. The form-action passes a real
  // boolean (never a "false" string), so no coercion footgun. Absent for one-offs.
  detach: z.boolean().optional(),
});

// The focused schedule operation: a required time plus an optional assignee.
export const jobScheduleSchema = z.object({
  id: z.uuid(),
  scheduled_start: z.iso.datetime({ offset: true }),
  assigned_to: optionalAssignee,
});

export const jobStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(JOB_STATUSES),
});

export const jobIdSchema = z.object({ id: z.uuid() });

export const jobListSchema = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  assigned_to: z.uuid().optional(),
});

// The scheduler week view reads jobs whose scheduled_start falls in a half-open
// [from, to) window, optionally for one assignee. The window is computed in UTC
// by the caller (lib/jobs/week.ts), the same convention scheduled_start is
// stored and displayed in.
export const jobScheduleRangeSchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  assigned_to: z.uuid().optional(),
});

// Recurrence (the jobs recurrence pass).

// The end of a repeat, as the form offers it: never, on a date, or after N
// occurrences. The action maps these onto job_series.repeat_until /
// max_occurrences (at most one set; both null is open-ended).
export const RECURRENCE_END_KINDS = ["never", "on", "after"] as const;

// The repeat-rule fields shared by every recurrence form (create, split,
// whole-series edit). interval and occurrence_count arrive as strings from a
// form, so they are coerced; an empty end field normalises to null.
const recurrenceShape = {
  frequency: z.enum(RECURRENCE_FREQUENCIES),
  interval: z.coerce.number().int().min(1).max(365),
  end_kind: z.enum(RECURRENCE_END_KINDS),
  until_date: z.preprocess(emptyToNull, z.iso.date().nullish()),
  occurrence_count: z.preprocess(
    emptyToNull,
    z.coerce.number().int().min(1).max(520).nullish()
  ),
};

// A repeat must carry the end its end_kind names; these refine messages surface
// as inline field errors on the form.
const ON_DATE_ERROR = { message: "Choose an end date", path: ["until_date"] };
const AFTER_COUNT_ERROR = {
  message: "Choose how many times it repeats",
  path: ["occurrence_count"],
};

const seriesTemplateShape = {
  title: z.string().trim().min(1, "Title is required").max(200),
  description: optionalText,
  customer_id: z.uuid("Choose a customer"),
  site_id: optionalSite,
  assigned_to: optionalAssignee,
};

// Create a recurring job: the template fields, the anchor (the first occurrence,
// required for a repeat), and the rule.
export const jobSeriesCreateSchema = z
  .object({
    ...seriesTemplateShape,
    scheduled_start: z.iso.datetime({ offset: true }),
    ...recurrenceShape,
  })
  .refine((r) => r.end_kind !== "on" || !!r.until_date, ON_DATE_ERROR)
  .refine(
    (r) => r.end_kind !== "after" || r.occurrence_count != null,
    AFTER_COUNT_ERROR
  )
  // An end date before the first occurrence would produce nothing.
  .refine(
    (r) =>
      r.end_kind !== "on" ||
      !r.until_date ||
      r.until_date >= r.scheduled_start.slice(0, 10),
    { message: "The end date must be on or after the start", path: ["until_date"] }
  );

// "Entire series" edit: change the rule and the template. An optional
// scheduled_start re-times the series: its time of day is applied to the
// series anchor (the anchor date is unchanged), so the future occurrences shift
// to the new time. Absent/empty leaves the time unchanged.
export const jobSeriesUpdateSchema = z
  .object({
    series_id: z.uuid(),
    ...seriesTemplateShape,
    scheduled_start: optionalSchedule,
    ...recurrenceShape,
  })
  .refine((r) => r.end_kind !== "on" || !!r.until_date, ON_DATE_ERROR)
  .refine(
    (r) => r.end_kind !== "after" || r.occurrence_count != null,
    AFTER_COUNT_ERROR
  );

// "This and all following" split: the occurrence to split at (its slot becomes
// the new series anchor) plus the new rule and template for the new series.
export const jobSeriesSplitSchema = z
  .object({
    id: z.uuid(),
    ...seriesTemplateShape,
    ...recurrenceShape,
  })
  .refine((r) => r.end_kind !== "on" || !!r.until_date, ON_DATE_ERROR)
  .refine(
    (r) => r.end_kind !== "after" || r.occurrence_count != null,
    AFTER_COUNT_ERROR
  );

// Delete (or skip) scope when a job belongs to a series.
export const JOB_DELETE_SCOPES = ["occurrence", "following", "series"] as const;

export const jobDeleteScopeSchema = z.object({
  id: z.uuid(),
  scope: z.enum(JOB_DELETE_SCOPES),
});
