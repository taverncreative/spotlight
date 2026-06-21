// Jobs recurrence action-level proofs (Phase 2, recurrence pass). Runs with:
// npm run test:jobs-recurrence
//
// Drives the real series actions through the jobs harness with a signed-in
// session, and inspects the resulting rows with the service role. This is where
// recurrence lives or dies, so each edit mode is proven, not assumed:
//   - a weekly series stamps the correct occurrences to the horizon;
//   - a single-occurrence edit detaches and survives a later whole-series edit;
//   - a whole-series edit regenerates future un-locked occurrences and leaves
//     past, completed, cancelled and detached ones intact;
//   - "this and following" splits the series, nothing before the split moved and
//     everything from it under a new series following the new rule;
//   - delete and skip variants behave;
//   - tenant isolation (cross-tenant by-id is a calm null) and the jobs
//     entitlement (a non-entitled org is blocked, read_only cannot write).

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { generateOccurrences } from "../lib/jobs/recurrence";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `jr-a-${run}`;
const slugB = `jr-b-${run}`;
const slugN = `jr-n-${run}`;
const emailFor = (label: string) => `${label}-${run}@jobs-recurrence.test`;

const DAY = 86_400_000;
const HORIZON_DAYS = 92; // keep in step with lib/jobs/series.ts

// The UTC time of day ("HH:MM") and date ("YYYY-MM-DD") of an instant, for
// asserting re-timing keeps the date and shifts the time.
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(
    d.getUTCMinutes()
  ).padStart(2, "0")}`;
};
const ymd = (iso: string) => new Date(iso).toISOString().slice(0, 10);

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
let planId: string;
let custAId: string;
let custBId: string;
let seriesBId: string;
let jobBId: string;
let writeUserId: string;

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["b", slugB],
    ["n", slugN],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Jobs Recurrence ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  const plan = await admin
    .from("plans")
    .insert({ key: `jr-${run}`, name: "JR", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planId = plan.data.id;
  const linked = await admin
    .from("plan_modules")
    .insert({ plan_id: planId, module: "jobs" });
  if (linked.error) throw new Error(linked.error.message);
  for (const label of ["a", "b"]) {
    const assigned = await admin.rpc("assign_plan", {
      org_id: orgIds[label],
      new_plan_id: planId,
    });
    if (assigned.error) throw new Error(assigned.error.message);
  }
  // Organisation N gets no plan (no jobs entitlement).

  for (const [label, orgLabel, role] of [
    ["write", "a", "client_admin"],
    ["read", "a", "read_only"],
    ["admin-n", "n", "client_admin"],
  ] as const) {
    const user = await admin.auth.admin.createUser({
      email: emailFor(label),
      password,
      email_confirm: true,
    });
    if (user.error || !user.data.user) throw new Error(user.error?.message);
    userIds.push(user.data.user.id);
    if (label === "write") writeUserId = user.data.user.id;
    const membership = await admin.from("organisation_memberships").insert({
      organisation_id: orgIds[orgLabel],
      user_id: user.data.user.id,
      role,
      status: "active",
    });
    if (membership.error) throw new Error(membership.error.message);
  }

  const custA = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.a, name: `Customer A ${run}` })
    .select("id")
    .single();
  if (custA.error) throw new Error(custA.error.message);
  custAId = custA.data.id;

  const custB = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.b, name: `Customer B ${run}` })
    .select("id")
    .single();
  if (custB.error) throw new Error(custB.error.message);
  custBId = custB.data.id;

  // A series in organisation B for the cross-tenant by-id checks.
  const seriesB = await admin
    .from("job_series")
    .insert({
      organisation_id: orgIds.b,
      frequency: "weekly",
      repeat_interval: 1,
      anchor_start: "2030-02-04T09:00:00.000Z",
      title: `Series B ${run}`,
      customer_id: custBId,
    })
    .select("id")
    .single();
  if (seriesB.error) throw new Error(seriesB.error.message);
  seriesBId = seriesB.data.id;
  const jobB = await admin
    .from("jobs")
    .insert({
      organisation_id: orgIds.b,
      customer_id: custBId,
      title: `Job B ${run}`,
      status: "scheduled",
      scheduled_start: "2030-02-04T09:00:00.000Z",
      series_id: seriesBId,
      series_slot: "2030-02-04T09:00:00.000Z",
    })
    .select("id")
    .single();
  if (jobB.error) throw new Error(jobB.error.message);
  jobBId = jobB.data.id;
});

test.afterAll(async () => {
  const ids = Object.values(orgIds);
  await admin.from("audit_log").delete().in("organisation_id", ids);
  await admin.from("notes").delete().in("organisation_id", ids);
  await admin.from("files").delete().in("organisation_id", ids);
  // jobs and series RESTRICT their customers' deletion, so clear them first.
  await admin.from("jobs").delete().in("organisation_id", ids);
  await admin.from("job_series").delete().in("organisation_id", ids);
  await admin.from("organisations").delete().in("id", ids);
  await admin.from("plans").delete().eq("id", planId);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
});

async function signIn(page: Page, label: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(emailFor(label));
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\//);
}

type ActResult = { status: number; data: unknown };

async function act(
  page: Page,
  action: string,
  input: unknown = {},
  slug = slugA
): Promise<ActResult> {
  const response = await page.request.post(`/api/jobs-harness/${slug}`, {
    data: { action, input },
  });
  let data: unknown = null;
  try {
    data = ((await response.json()) as { data?: unknown }).data ?? null;
  } catch {
    // non-JSON (a 404 page) leaves data null
  }
  return { status: response.status(), data };
}

type JobRow = {
  id: string;
  title: string;
  status: string;
  scheduled_start: string | null;
  series_slot: string | null;
  series_id: string | null;
  is_detached: boolean;
};

// Every job of a series, by slot, read with the service role.
async function seriesJobs(seriesId: string): Promise<JobRow[]> {
  const { data, error } = await admin
    .from("jobs")
    .select("id, title, status, scheduled_start, series_slot, series_id, is_detached")
    .eq("series_id", seriesId)
    .order("series_slot", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as JobRow[];
}

async function getJobRow(id: string): Promise<JobRow | null> {
  const { data } = await admin
    .from("jobs")
    .select("id, title, status, scheduled_start, series_slot, series_id, is_detached")
    .eq("id", id)
    .maybeSingle();
  return (data as JobRow) ?? null;
}

type CreateResult = { seriesId: string; jobId: string | null };

async function createSeries(
  page: Page,
  input: Record<string, unknown>
): Promise<CreateResult> {
  const { data } = await act(page, "createJobSeries", input);
  return data as CreateResult;
}

const weeklyHorizon = (anchorIso: string) =>
  new Date(new Date(anchorIso).getTime() + HORIZON_DAYS * DAY);

test("a weekly series stamps the correct occurrences to the horizon", async ({
  page,
}) => {
  await signIn(page, "write");
  const anchor = "2030-01-07T09:00:00.000Z"; // a future Monday
  const result = await createSeries(page, {
    title: `Weekly ${run}`,
    customer_id: custAId,
    scheduled_start: anchor,
    frequency: "weekly",
    interval: 1,
    end_kind: "never",
  });
  expect(result.seriesId).toBeTruthy();
  expect(result.jobId).toBeTruthy();

  const expected = generateOccurrences(
    { frequency: "weekly", interval: 1, anchor: new Date(anchor) },
    weeklyHorizon(anchor)
  ).map((d) => d.toISOString());

  const jobs = await seriesJobs(result.seriesId);
  // Compare as instants: the database returns timestamptz as "+00:00", not ".000Z".
  expect(jobs.map((j) => new Date(j.scheduled_start!).toISOString())).toEqual(
    expected
  );
  // Each occurrence inherits the template, is scheduled, attached and on its slot.
  for (const job of jobs) {
    expect(job.title).toBe(`Weekly ${run}`);
    expect(job.status).toBe("scheduled");
    expect(job.is_detached).toBe(false);
    expect(job.series_slot).toBe(job.scheduled_start);
    expect(job.series_id).toBe(result.seriesId);
  }
});

test("end after N yields exactly N occurrences", async ({ page }) => {
  await signIn(page, "write");
  const anchor = "2030-03-04T08:00:00.000Z";
  const result = await createSeries(page, {
    title: `Counted ${run}`,
    customer_id: custAId,
    scheduled_start: anchor,
    frequency: "weekly",
    interval: 1,
    end_kind: "after",
    occurrence_count: 4,
  });
  const jobs = await seriesJobs(result.seriesId);
  expect(jobs.length).toBe(4);
});

test("single-occurrence edit detaches and survives a whole-series edit", async ({
  page,
}) => {
  await signIn(page, "write");
  const anchor = "2030-04-01T09:00:00.000Z";
  const { seriesId } = await createSeries(page, {
    title: `Detach ${run}`,
    customer_id: custAId,
    scheduled_start: anchor,
    frequency: "weekly",
    interval: 1,
    end_kind: "never",
  });
  const before = await seriesJobs(seriesId);
  const target = before[2]; // the 3rd occurrence
  const movedStart = "2030-04-16T15:30:00.000Z"; // a deliberately off-grid time

  // This occurrence only: detach, rename and move it.
  const edited = await act(page, "updateJob", {
    id: target.id,
    title: `EDITED ${run}`,
    scheduled_start: movedStart,
    detach: true,
  });
  expect(edited.status).toBe(200);
  let detached = await getJobRow(target.id);
  expect(detached?.is_detached).toBe(true);
  expect(detached?.title).toBe(`EDITED ${run}`);
  expect(detached?.series_slot).toBe(target.series_slot); // slot unchanged

  // Whole-series edit: rename the series.
  const whole = await act(page, "updateJobSeries", {
    series_id: seriesId,
    title: `SERIES-NEW ${run}`,
    customer_id: custAId,
    frequency: "weekly",
    interval: 1,
    end_kind: "never",
  });
  expect(whole.status).toBe(200);

  // The detached occurrence is untouched by the regeneration.
  detached = await getJobRow(target.id);
  expect(detached).not.toBeNull();
  expect(detached?.is_detached).toBe(true);
  expect(detached?.title).toBe(`EDITED ${run}`);
  expect(new Date(detached!.scheduled_start!).toISOString()).toBe(movedStart);

  // Its original slot was not resurrected by a fresh job.
  const after = await seriesJobs(seriesId);
  const atOldSlot = after.filter(
    (j) => j.series_slot === target.series_slot && j.id !== target.id
  );
  expect(atOldSlot.length).toBe(0);
  // Every other (regenerated) occurrence carries the new title.
  for (const job of after) {
    if (job.id === target.id) continue;
    expect(job.title).toBe(`SERIES-NEW ${run}`);
  }
});

test("whole-series edit regenerates future un-locked, leaving past/completed/cancelled/detached intact", async ({
  page,
}) => {
  await signIn(page, "write");
  // Anchor five weeks ago, so the series spans past and future occurrences.
  const anchor = new Date(Date.now() - 35 * DAY);
  anchor.setUTCHours(9, 0, 0, 0);
  const { seriesId } = await createSeries(page, {
    title: `ORIGINAL ${run}`,
    customer_id: custAId,
    scheduled_start: anchor.toISOString(),
    frequency: "weekly",
    interval: 1,
    end_kind: "never",
  });
  const jobs = await seriesJobs(seriesId);
  const now = Date.now();
  const past = jobs.filter((j) => new Date(j.scheduled_start!).getTime() < now);
  const future = jobs.filter((j) => new Date(j.scheduled_start!).getTime() >= now);
  expect(past.length).toBeGreaterThan(0);
  expect(future.length).toBeGreaterThan(3);

  const pastJob = past[0];
  const completedJob = future[0];
  const cancelledJob = future[1];
  const detachedJob = future[2];

  // Lock three future occurrences in different ways.
  await act(page, "setJobStatus", { id: completedJob.id, status: "completed" });
  await act(page, "setJobStatus", { id: cancelledJob.id, status: "cancelled" });
  await act(page, "updateJob", {
    id: detachedJob.id,
    title: `KEEP-DETACHED ${run}`,
    detach: true,
  });

  // Whole-series edit: rename.
  const whole = await act(page, "updateJobSeries", {
    series_id: seriesId,
    title: `NEW ${run}`,
    customer_id: custAId,
    frequency: "weekly",
    interval: 1,
    end_kind: "never",
  });
  expect(whole.status).toBe(200);

  // Past occurrence untouched (kept, old title).
  const pastAfter = await getJobRow(pastJob.id);
  expect(pastAfter?.title).toBe(`ORIGINAL ${run}`);
  // Completed and cancelled untouched.
  const completedAfter = await getJobRow(completedJob.id);
  expect(completedAfter?.status).toBe("completed");
  expect(completedAfter?.title).toBe(`ORIGINAL ${run}`);
  const cancelledAfter = await getJobRow(cancelledJob.id);
  expect(cancelledAfter?.status).toBe("cancelled");
  // Detached occurrence untouched (kept its individual edit).
  const detachedAfter = await getJobRow(detachedJob.id);
  expect(detachedAfter?.title).toBe(`KEEP-DETACHED ${run}`);
  expect(detachedAfter?.is_detached).toBe(true);

  // Future un-locked occurrences were regenerated to the new title; no future
  // un-locked occurrence still carries the old title.
  const after = await seriesJobs(seriesId);
  const lockedIds = new Set([
    completedJob.id,
    cancelledJob.id,
    detachedJob.id,
  ]);
  const futureUnlocked = after.filter(
    (j) =>
      new Date(j.scheduled_start!).getTime() >= now && !lockedIds.has(j.id)
  );
  expect(futureUnlocked.length).toBeGreaterThan(0);
  for (const job of futureUnlocked) expect(job.title).toBe(`NEW ${run}`);
});

test("this-and-following splits the series, nothing before the split moved", async ({
  page,
}) => {
  await signIn(page, "write");
  const anchor = "2030-06-03T09:00:00.000Z"; // future, weekly
  const { seriesId: seriesA } = await createSeries(page, {
    title: `ORIG ${run}`,
    customer_id: custAId,
    scheduled_start: anchor,
    frequency: "weekly",
    interval: 1,
    end_kind: "never",
  });
  const before = await seriesJobs(seriesA);
  expect(before.length).toBeGreaterThan(6);
  const beforeSplit = before.slice(0, 4); // O0..O3 stay with A
  const splitJob = before[4]; // O4 is the split point
  const splitSlot = splitJob.series_slot!;

  const split = await act(page, "splitJobSeries", {
    id: splitJob.id,
    title: `FOLLOWING-NEW ${run}`,
    customer_id: custAId,
    frequency: "weekly",
    interval: 2, // a new, different rule
    end_kind: "never",
  });
  expect(split.status).toBe(200);
  const newSeriesId = (split.data as { seriesId: string }).seriesId;
  expect(newSeriesId).toBeTruthy();
  expect(newSeriesId).not.toBe(seriesA);

  // Series A keeps exactly O0..O3, unchanged (same ids, titles, slots).
  const aAfter = await seriesJobs(seriesA);
  expect(aAfter.map((j) => j.id).sort()).toEqual(
    beforeSplit.map((j) => j.id).sort()
  );
  for (const job of aAfter) {
    expect(job.title).toBe(`ORIG ${run}`);
    expect(new Date(job.series_slot!).getTime()).toBeLessThan(
      new Date(splitSlot).getTime()
    );
  }

  // Series B begins at the split slot and follows the new every-2-weeks rule.
  const bJobs = await seriesJobs(newSeriesId);
  expect(bJobs.length).toBeGreaterThan(1);
  expect(bJobs[0].series_slot).toBe(splitSlot);
  for (const job of bJobs) expect(job.title).toBe(`FOLLOWING-NEW ${run}`);
  const gapDays =
    (new Date(bJobs[1].series_slot!).getTime() -
      new Date(bJobs[0].series_slot!).getTime()) /
    DAY;
  expect(gapDays).toBe(14); // every 2 weeks
});

test("delete variants: occurrence (no resurrection), following, series", async ({
  page,
}) => {
  await signIn(page, "write");

  // occurrence: delete one, then a whole-series edit must not resurrect its slot.
  {
    const anchor = "2030-08-05T09:00:00.000Z";
    const { seriesId } = await createSeries(page, {
      title: `Del ${run}`,
      customer_id: custAId,
      scheduled_start: anchor,
      frequency: "weekly",
      interval: 1,
      end_kind: "never",
    });
    const jobs = await seriesJobs(seriesId);
    const victim = jobs[3];
    const victimSlot = victim.series_slot!;
    const del = await act(page, "deleteJobScoped", {
      id: victim.id,
      scope: "occurrence",
    });
    expect(del.status).toBe(200);
    expect(await getJobRow(victim.id)).toBeNull();

    await act(page, "updateJobSeries", {
      series_id: seriesId,
      title: `Del-NEW ${run}`,
      customer_id: custAId,
      frequency: "weekly",
      interval: 1,
      end_kind: "never",
    });
    const after = await seriesJobs(seriesId);
    expect(after.filter((j) => j.series_slot === victimSlot).length).toBe(0);
  }

  // following: delete this and after; earlier occurrences remain.
  {
    const anchor = "2031-01-06T09:00:00.000Z";
    const { seriesId } = await createSeries(page, {
      title: `Foll ${run}`,
      customer_id: custAId,
      scheduled_start: anchor,
      frequency: "weekly",
      interval: 1,
      end_kind: "never",
    });
    const jobs = await seriesJobs(seriesId);
    const cut = jobs[3];
    const cutSlot = new Date(cut.series_slot!).getTime();
    const del = await act(page, "deleteJobScoped", {
      id: cut.id,
      scope: "following",
    });
    expect(del.status).toBe(200);
    const after = await seriesJobs(seriesId);
    expect(after.length).toBe(3); // O0..O2 only
    for (const job of after) {
      expect(new Date(job.series_slot!).getTime()).toBeLessThan(cutSlot);
    }
  }

  // series: removes every occurrence and the series row.
  {
    const anchor = "2031-04-07T09:00:00.000Z";
    const { seriesId } = await createSeries(page, {
      title: `Whole ${run}`,
      customer_id: custAId,
      scheduled_start: anchor,
      frequency: "weekly",
      interval: 1,
      end_kind: "never",
    });
    const del = await act(page, "deleteJobScoped", {
      id: (await seriesJobs(seriesId))[0].id,
      scope: "series",
    });
    expect(del.status).toBe(200);
    expect((await seriesJobs(seriesId)).length).toBe(0);
    const { data: gone } = await act(page, "getJobSeries", { id: seriesId });
    expect(gone).toBeNull();
  }
});

test("skip cancels and detaches a single occurrence, surviving regeneration", async ({
  page,
}) => {
  await signIn(page, "write");
  const anchor = "2031-07-07T09:00:00.000Z";
  const { seriesId } = await createSeries(page, {
    title: `Skip ${run}`,
    customer_id: custAId,
    scheduled_start: anchor,
    frequency: "weekly",
    interval: 1,
    end_kind: "never",
  });
  const jobs = await seriesJobs(seriesId);
  const skipped = jobs[2];
  const skippedSlot = skipped.series_slot!;
  const res = await act(page, "skipJobOccurrence", { id: skipped.id });
  expect(res.status).toBe(200);
  let row = await getJobRow(skipped.id);
  expect(row?.status).toBe("cancelled");
  expect(row?.is_detached).toBe(true);

  await act(page, "updateJobSeries", {
    series_id: seriesId,
    title: `Skip-NEW ${run}`,
    customer_id: custAId,
    frequency: "weekly",
    interval: 1,
    end_kind: "never",
  });
  // Still cancelled and detached, and not duplicated at its slot.
  row = await getJobRow(skipped.id);
  expect(row?.status).toBe("cancelled");
  expect(row?.is_detached).toBe(true);
  const after = await seriesJobs(seriesId);
  expect(after.filter((j) => j.series_slot === skippedSlot).length).toBe(1);
});

test("a whole-series edit preserves notes and files on persisting occurrences", async ({
  page,
}) => {
  await signIn(page, "write");
  // Weekly, future anchor, ending after 6 -> six occurrences a week apart.
  const anchor = "2030-09-03T09:00:00.000Z";
  const { seriesId } = await createSeries(page, {
    title: `Reconcile ${run}`,
    customer_id: custAId,
    scheduled_start: anchor,
    frequency: "weekly",
    interval: 1,
    end_kind: "after",
    occurrence_count: 6,
  });
  const before = await seriesJobs(seriesId);
  expect(before.length).toBe(6);
  const keep = before[2]; // anchor + 14 days, an even week -> persists under every-2-weeks
  const keepSlotMs = new Date(keep.series_slot!).getTime();
  const removeId = before[1].id; // anchor + 7 days, an odd week -> removed

  // Attach a note and a file to the persisting occurrence's job row.
  const note = await admin
    .from("notes")
    .insert({
      organisation_id: orgIds.a,
      related_type: "job",
      related_id: keep.id,
      body: `keep note ${run}`,
      created_by: writeUserId,
      updated_by: writeUserId,
    })
    .select("id")
    .single();
  if (note.error) throw new Error(note.error.message);
  const file = await admin
    .from("files")
    .insert({
      organisation_id: orgIds.a,
      related_type: "job",
      related_id: keep.id,
      filename: "keep.txt",
      storage_path: `${orgIds.a}/job/${keep.id}/${crypto.randomUUID()}-keep.txt`,
      size_bytes: 12,
      mime_type: "text/plain",
      created_by: writeUserId,
      updated_by: writeUserId,
    })
    .select("id")
    .single();
  if (file.error) throw new Error(file.error.message);

  // Whole-series edit that shifts the schedule: every 2 weeks, open-ended, renamed.
  const edit = await act(page, "updateJobSeries", {
    series_id: seriesId,
    title: `Reconcile-NEW ${run}`,
    customer_id: custAId,
    frequency: "weekly",
    interval: 2,
    end_kind: "never",
  });
  expect(edit.status).toBe(200);

  // The persisting occurrence kept its job id (so its note and file survive),
  // reflects the new template and stays on its slot.
  const keepAfter = await getJobRow(keep.id);
  expect(keepAfter).not.toBeNull();
  expect(keepAfter?.title).toBe(`Reconcile-NEW ${run}`);
  expect(new Date(keepAfter!.series_slot!).getTime()).toBe(keepSlotMs);
  const noteAfter = await admin
    .from("notes")
    .select("id, related_id")
    .eq("id", note.data.id)
    .maybeSingle();
  expect(noteAfter.data?.related_id).toBe(keep.id);
  const fileAfter = await admin
    .from("files")
    .select("id, related_id")
    .eq("id", file.data.id)
    .maybeSingle();
  expect(fileAfter.data?.related_id).toBe(keep.id);

  // An odd-week occurrence was removed (the schedule genuinely shifted), and new
  // slots beyond the original window were created.
  expect(await getJobRow(removeId)).toBeNull();
  const after = await seriesJobs(seriesId);
  const maxBefore = Math.max(
    ...before.map((j) => new Date(j.series_slot!).getTime())
  );
  expect(
    after.some((j) => new Date(j.series_slot!).getTime() > maxBefore)
  ).toBe(true);
});

test("an entire-series time change re-times future un-locked occurrences, preserving notes/files and leaving locked/past intact", async ({
  page,
}) => {
  await signIn(page, "write");
  // Anchor 35 days ago at 07:30, weekly, so occurrences span past and future.
  const anchor = new Date(Date.now() - 35 * DAY);
  anchor.setUTCHours(7, 30, 0, 0);
  const { seriesId } = await createSeries(page, {
    title: `Retime ${run}`,
    customer_id: custAId,
    scheduled_start: anchor.toISOString(),
    frequency: "weekly",
    interval: 1,
    end_kind: "never",
  });
  const before = await seriesJobs(seriesId);
  const now = Date.now();
  const past = before.filter((j) => new Date(j.scheduled_start!).getTime() < now);
  const future = before.filter(
    (j) => new Date(j.scheduled_start!).getTime() >= now
  );
  expect(past.length).toBeGreaterThan(0);
  expect(future.length).toBeGreaterThan(2);

  // Use clearly-separated occurrences (far future, far past) to avoid the
  // boundary-adjacent occurrence whose past/future side could flip.
  const keep = future[future.length - 1];
  const completed = future[future.length - 2];
  const pastJob = past[0];

  // A note and a file on the persisting (far-future) occurrence.
  const note = await admin
    .from("notes")
    .insert({
      organisation_id: orgIds.a,
      related_type: "job",
      related_id: keep.id,
      body: `retime note ${run}`,
      created_by: writeUserId,
      updated_by: writeUserId,
    })
    .select("id")
    .single();
  if (note.error) throw new Error(note.error.message);
  const file = await admin
    .from("files")
    .insert({
      organisation_id: orgIds.a,
      related_type: "job",
      related_id: keep.id,
      filename: "retime.txt",
      storage_path: `${orgIds.a}/job/${keep.id}/${crypto.randomUUID()}-retime.txt`,
      size_bytes: 7,
      mime_type: "text/plain",
      created_by: writeUserId,
      updated_by: writeUserId,
    })
    .select("id")
    .single();
  if (file.error) throw new Error(file.error.message);

  await act(page, "setJobStatus", { id: completed.id, status: "completed" });

  // Re-time the whole series to 08:00, same weekly cadence. Only the time of day
  // of scheduled_start is applied; its date is ignored.
  const edit = await act(page, "updateJobSeries", {
    series_id: seriesId,
    title: `Retime ${run}`,
    customer_id: custAId,
    frequency: "weekly",
    interval: 1,
    end_kind: "never",
    scheduled_start: "2030-01-01T08:00:00.000Z",
  });
  expect(edit.status).toBe(200);

  // The persisting occurrence: same id and date, re-timed to 08:00, note+file kept.
  const keepAfter = await getJobRow(keep.id);
  expect(keepAfter).not.toBeNull();
  expect(ymd(keepAfter!.scheduled_start!)).toBe(ymd(keep.scheduled_start!));
  expect(hhmm(keepAfter!.scheduled_start!)).toBe("08:00");
  expect(hhmm(keepAfter!.series_slot!)).toBe("08:00");
  const noteAfter = await admin
    .from("notes")
    .select("related_id")
    .eq("id", note.data.id)
    .maybeSingle();
  expect(noteAfter.data?.related_id).toBe(keep.id);
  const fileAfter = await admin
    .from("files")
    .select("related_id")
    .eq("id", file.data.id)
    .maybeSingle();
  expect(fileAfter.data?.related_id).toBe(keep.id);

  // Locked (completed) future occurrence and a past occurrence keep 07:30.
  expect(hhmm((await getJobRow(completed.id))!.scheduled_start!)).toBe("07:30");
  expect(hhmm((await getJobRow(pastJob.id))!.scheduled_start!)).toBe("07:30");

  // Every clearly-future un-locked occurrence is now at 08:00; cadence intact
  // (the keep occurrence's date is unchanged, asserted above).
  const after = await seriesJobs(seriesId);
  const clearlyFuture = after.filter(
    (j) =>
      new Date(j.scheduled_start!).getTime() > now + 3 * DAY &&
      !j.is_detached &&
      j.status !== "completed" &&
      j.status !== "cancelled"
  );
  expect(clearlyFuture.length).toBeGreaterThan(1);
  for (const j of clearlyFuture) expect(hhmm(j.scheduled_start!)).toBe("08:00");
});

test("a combined time-and-cadence entire-series edit lands the right slots at the new time", async ({
  page,
}) => {
  await signIn(page, "write");
  // Weekly 07:30, future anchor, six occurrences a week apart.
  const anchor = "2030-09-02T07:30:00.000Z";
  const { seriesId } = await createSeries(page, {
    title: `Combo ${run}`,
    customer_id: custAId,
    scheduled_start: anchor,
    frequency: "weekly",
    interval: 1,
    end_kind: "after",
    occurrence_count: 6,
  });
  const before = await seriesJobs(seriesId);
  expect(before.length).toBe(6);
  const keep = before[2]; // anchor + 14 days, an even week -> persists under every-2-weeks
  const oddWeekId = before[1].id; // anchor + 7 days -> removed
  const lastDateBefore = new Date(
    before[before.length - 1].series_slot!
  ).getTime();

  // Note + file on the persisting occurrence.
  const note = await admin
    .from("notes")
    .insert({
      organisation_id: orgIds.a,
      related_type: "job",
      related_id: keep.id,
      body: `combo note ${run}`,
      created_by: writeUserId,
      updated_by: writeUserId,
    })
    .select("id")
    .single();
  if (note.error) throw new Error(note.error.message);

  // Every 2 weeks at 08:00, open-ended.
  const edit = await act(page, "updateJobSeries", {
    series_id: seriesId,
    title: `Combo ${run}`,
    customer_id: custAId,
    frequency: "weekly",
    interval: 2,
    end_kind: "never",
    scheduled_start: "2030-01-01T08:00:00.000Z",
  });
  expect(edit.status).toBe(200);

  // The persisting (even-week) occurrence kept its id and date, re-timed to 08:00,
  // and kept its note.
  const keepAfter = await getJobRow(keep.id);
  expect(keepAfter).not.toBeNull();
  expect(ymd(keepAfter!.scheduled_start!)).toBe(ymd(keep.scheduled_start!));
  expect(hhmm(keepAfter!.scheduled_start!)).toBe("08:00");
  const noteAfter = await admin
    .from("notes")
    .select("related_id")
    .eq("id", note.data.id)
    .maybeSingle();
  expect(noteAfter.data?.related_id).toBe(keep.id);

  // The odd-week occurrence is gone, a later new slot was created, and every
  // occurrence sits at 08:00 on an even-week (14-day) cadence.
  expect(await getJobRow(oddWeekId)).toBeNull();
  const after = await seriesJobs(seriesId);
  for (const j of after) expect(hhmm(j.scheduled_start!)).toBe("08:00");
  expect(
    after.some((j) => new Date(j.series_slot!).getTime() > lastDateBefore)
  ).toBe(true);
  // 14-day spacing between consecutive occurrences.
  const slots = after
    .map((j) => new Date(j.series_slot!).getTime())
    .sort((a, b) => a - b);
  expect((slots[1] - slots[0]) / DAY).toBe(14);
});

test("tenant isolation and the jobs entitlement hold for series actions", async ({
  page,
}) => {
  // Cross-tenant by id is a calm null.
  await signIn(page, "write");
  expect((await act(page, "getJobSeries", { id: seriesBId })).data).toBeNull();
  expect(
    (
      await act(page, "updateJobSeries", {
        series_id: seriesBId,
        title: "x",
        customer_id: custAId,
        frequency: "weekly",
        interval: 1,
        end_kind: "never",
      })
    ).data
  ).toBeNull();
  expect(
    (
      await act(page, "splitJobSeries", {
        id: jobBId,
        title: "x",
        customer_id: custAId,
        frequency: "weekly",
        interval: 1,
        end_kind: "never",
      })
    ).data
  ).toBeNull();

  // read_only cannot create a series.
  await signIn(page, "read");
  expect(
    (
      await act(page, "createJobSeries", {
        title: "RO",
        customer_id: custAId,
        scheduled_start: "2030-01-07T09:00:00.000Z",
        frequency: "weekly",
        interval: 1,
        end_kind: "never",
      })
    ).status
  ).toBe(403);

  // An organisation without the jobs entitlement is blocked.
  await signIn(page, "admin-n");
  expect(
    (
      await act(
        page,
        "createJobSeries",
        {
          title: "N",
          customer_id: custAId,
          scheduled_start: "2030-01-07T09:00:00.000Z",
          frequency: "weekly",
          interval: 1,
          end_kind: "never",
        },
        slugN
      )
    ).status
  ).toBe(403);
});
