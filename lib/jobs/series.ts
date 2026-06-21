import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateOccurrences,
  type Frequency,
  type RecurrenceRule,
} from "@/lib/jobs/recurrence";

// Server-side series generation and regeneration (Phase 2, recurrence pass). The
// pure rule maths lives in lib/jobs/recurrence.ts; this module turns a stored
// job_series row into real job rows, and handles the regeneration that the
// "entire series" edit and the "this and following" split rely on. Callers are
// the gated jobs actions, which pass their user-session Supabase client (RLS is
// the enforcement; this module adds none of its own).

// About three months of occurrences are stamped on create/edit. Rolling this
// horizon forward over time is the deployment-era runner's job, not built here.
// Kept in whole UTC days for clean arithmetic.
export const HORIZON_DAYS = 92;
const DAY_MS = 86_400_000;

export const SERIES_COLUMNS =
  "id, organisation_id, frequency, repeat_interval, anchor_start, repeat_until, max_occurrences, generated_until, skipped_slots, title, description, customer_id, site_id, assigned_to";

export type SeriesRow = {
  id: string;
  organisation_id: string;
  frequency: string;
  repeat_interval: number;
  anchor_start: string;
  repeat_until: string | null;
  max_occurrences: number | null;
  generated_until: string | null;
  skipped_slots: string[];
  title: string;
  description: string | null;
  customer_id: string;
  site_id: string | null;
  assigned_to: string | null;
};

type OccurrenceRow = {
  id: string;
  status: string;
  scheduled_start: string | null;
  series_slot: string | null;
  is_detached: boolean;
};

// The stored series as a rule the pure engine consumes.
export function ruleFromSeries(series: SeriesRow): RecurrenceRule {
  return {
    frequency: series.frequency as Frequency,
    interval: series.repeat_interval,
    anchor: new Date(series.anchor_start),
    until: series.repeat_until ? new Date(series.repeat_until) : null,
    count: series.max_occurrences,
  };
}

// The generation horizon: ~3 months from the later of the anchor and now, so a
// future-dated series still gets a full window and an ongoing one stays topped
// up to roughly three months ahead.
export function horizonFrom(anchor: Date, now: Date): Date {
  const base = anchor.getTime() > now.getTime() ? anchor : now;
  return new Date(base.getTime() + HORIZON_DAYS * DAY_MS);
}

// Map the form's end choice onto the stored columns. "On a date" is inclusive of
// that date, so the exclusive bound is the next UTC midnight.
export function endColumns(input: {
  end_kind: string;
  until_date?: string | null;
  occurrence_count?: number | null;
}): { repeat_until: string | null; max_occurrences: number | null } {
  if (input.end_kind === "on" && input.until_date) {
    const day = new Date(`${input.until_date}T00:00:00.000Z`);
    return {
      repeat_until: new Date(day.getTime() + DAY_MS).toISOString(),
      max_occurrences: null,
    };
  }
  if (input.end_kind === "after" && input.occurrence_count != null) {
    return { repeat_until: null, max_occurrences: input.occurrence_count };
  }
  return { repeat_until: null, max_occurrences: null };
}

// A job is locked (a series regeneration must leave it alone) when it has been
// individually detached, completed or cancelled.
function isLocked(job: OccurrenceRow): boolean {
  return (
    job.is_detached ||
    job.status === "completed" ||
    job.status === "cancelled"
  );
}

function slotTimes(jobs: OccurrenceRow[]): Set<number> {
  const set = new Set<number>();
  for (const job of jobs) {
    if (job.series_slot) set.add(new Date(job.series_slot).getTime());
  }
  return set;
}

// Stamp job rows for the rule's slots from `from` (inclusive) to the horizon,
// skipping slots already occupied by a surviving occurrence and slots the series
// records as skipped (deleted "this occurrence only"). Returns the new job ids.
export async function stampOccurrences(
  supabase: SupabaseClient,
  params: {
    series: SeriesRow;
    userId: string;
    from: Date;
    horizon: Date;
    occupied: Set<number>;
  }
): Promise<string[]> {
  const rule = ruleFromSeries(params.series);
  const skipped = new Set(
    params.series.skipped_slots.map((s) => new Date(s).getTime())
  );
  const fromMs = params.from.getTime();

  const slots = generateOccurrences(rule, params.horizon).filter((slot) => {
    const t = slot.getTime();
    return t >= fromMs && !skipped.has(t) && !params.occupied.has(t);
  });
  return insertOccurrences(supabase, params.series, params.userId, slots);
}

// Insert one occurrence job row per slot, inheriting the series template. Shared
// by stampOccurrences and the regeneration's "create new slots" step.
async function insertOccurrences(
  supabase: SupabaseClient,
  series: SeriesRow,
  userId: string,
  slots: Date[]
): Promise<string[]> {
  if (slots.length === 0) return [];
  const rows = slots.map((slot) => ({
    organisation_id: series.organisation_id,
    customer_id: series.customer_id,
    site_id: series.site_id,
    title: series.title,
    description: series.description,
    assigned_to: series.assigned_to,
    status: "scheduled",
    scheduled_start: slot.toISOString(),
    series_id: series.id,
    series_slot: slot.toISOString(),
    is_detached: false,
    created_by: userId,
    updated_by: userId,
  }));
  const { data, error } = await supabase.from("jobs").insert(rows).select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.id as string);
}

// The UTC calendar-day key of an instant (its midnight epoch ms). Occurrences
// are at most one per day for every supported cadence, so the day is a stable
// identity for an occurrence across a time-of-day change.
function utcDayKey(iso: string | Date): number {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// Regenerate a series' future, un-locked occurrences to its current rule by
// RECONCILING against the rule's slots, not by delete-and-recreate, so notes and
// files attached to an occurrence survive. Matching is by the occurrence's UTC
// day (one occurrence per day for every cadence), so a time-of-day change
// re-times an occurrence rather than dropping and recreating it:
//   - a future un-locked occurrence whose DAY still has a slot is updated in
//     place to that slot (the new template AND the new instant), keeping its job
//     id, notes and files; a pure rule change leaves the instant unchanged, a
//     re-time shifts it;
//   - a future un-locked occurrence whose day has no slot is removed;
//   - days with a slot but no occurrence get fresh job rows.
// Past, completed, cancelled and detached occurrences are left untouched, and
// their days stay occupied so nothing duplicates them. The "entire series" edit.
export async function regenerateFuture(
  supabase: SupabaseClient,
  params: { series: SeriesRow; userId: string; boundary: Date; horizon: Date }
): Promise<void> {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, status, scheduled_start, series_slot, is_detached")
    .eq("organisation_id", params.series.organisation_id)
    .eq("series_id", params.series.id);
  if (error) throw new Error(error.message);
  const jobs = (data ?? []) as OccurrenceRow[];
  const boundaryMs = params.boundary.getTime();

  const isPast = (job: OccurrenceRow) =>
    job.scheduled_start != null &&
    new Date(job.scheduled_start).getTime() < boundaryMs;

  const reconcilable = jobs.filter((job) => !isLocked(job) && !isPast(job));
  const survivors = jobs.filter((job) => isLocked(job) || isPast(job));

  // The days a surviving (locked or past) occurrence holds, and the skipped
  // days, are off-limits to the rule's new slots.
  const occupiedDays = new Set<number>();
  for (const job of survivors) {
    if (job.series_slot) occupiedDays.add(utcDayKey(job.series_slot));
  }
  const skippedDays = new Set(
    params.series.skipped_slots.map((s) => utcDayKey(s))
  );

  // The rule's future slots, keyed by their UTC day (the new instant per day).
  const slotByDay = new Map<number, Date>();
  for (const slot of generateOccurrences(
    ruleFromSeries(params.series),
    params.horizon
  )) {
    if (slot.getTime() < boundaryMs) continue;
    const day = utcDayKey(slot);
    if (occupiedDays.has(day) || skippedDays.has(day)) continue;
    slotByDay.set(day, slot);
  }

  // Pair each future un-locked occurrence with its day's slot: persisting ones
  // are re-timed in place, the rest are removed. Days left in slotByDay are new.
  const toRemoveIds: string[] = [];
  const toReschedule: Array<{ id: string; slot: Date }> = [];
  for (const job of reconcilable) {
    const day = job.series_slot ? utcDayKey(job.series_slot) : Number.NaN;
    const slot = Number.isNaN(day) ? undefined : slotByDay.get(day);
    if (slot) {
      toReschedule.push({ id: job.id, slot });
      slotByDay.delete(day);
    } else {
      toRemoveIds.push(job.id);
    }
  }

  // 1. Update each persisting occurrence in place: the new template AND its
  //    new slot instant (scheduled_start and series_slot), keeping the job id so
  //    its notes and files survive. Per row, since each lands on its own slot.
  for (const { id, slot } of toReschedule) {
    const upd = await supabase
      .from("jobs")
      .update({
        title: params.series.title,
        description: params.series.description,
        customer_id: params.series.customer_id,
        site_id: params.series.site_id,
        assigned_to: params.series.assigned_to,
        scheduled_start: slot.toISOString(),
        series_slot: slot.toISOString(),
        updated_by: params.userId,
      })
      .eq("id", id);
    if (upd.error) throw new Error(upd.error.message);
  }

  // 2. Remove the occurrences whose day no longer has a slot under the rule.
  if (toRemoveIds.length) {
    const del = await supabase.from("jobs").delete().in("id", toRemoveIds);
    if (del.error) throw new Error(del.error.message);
  }

  // 3. Create rows for the genuinely new slots (days with a slot but no
  //    surviving or persisting occurrence).
  await insertOccurrences(
    supabase,
    params.series,
    params.userId,
    [...slotByDay.values()]
  );
}

export { isLocked, slotTimes };
export type { OccurrenceRow };
