// Jobs recurrence screen smoke (Phase 2, recurrence pass). Runs with:
// npm run test:jobs-recurrence-screen
//
// Proves the recurrence UI is wired end to end: creating a job with "Repeats"
// on stamps a series and lands on an occurrence whose detail shows the rule; the
// list and the occurrence carry the recurrence indicator; the edit form offers
// the three-way scope picker; and the delete dialog offers the three scopes. The
// edit-mode semantics themselves are proven at the action level in
// tests/jobs-recurrence.spec.ts; this guards the form wiring.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `jrs-a-${run}`;
const emailFor = (label: string) => `${label}-${run}@jobs-rec-screen.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const userIds: string[] = [];
let orgId: string;
let planId: string;
let custId: string;

test.beforeAll(async () => {
  const org = await admin
    .from("organisations")
    .insert({ name: `Jobs Rec Screen ${run}`, slug: slugA })
    .select("id")
    .single();
  if (org.error) throw new Error(org.error.message);
  orgId = org.data.id;

  const plan = await admin
    .from("plans")
    .insert({ key: `jrs-${run}`, name: "JRS", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planId = plan.data.id;
  const linked = await admin
    .from("plan_modules")
    .insert({ plan_id: planId, module: "jobs" });
  if (linked.error) throw new Error(linked.error.message);
  const assigned = await admin.rpc("assign_plan", {
    org_id: orgId,
    new_plan_id: planId,
  });
  if (assigned.error) throw new Error(assigned.error.message);

  const user = await admin.auth.admin.createUser({
    email: emailFor("write"),
    password,
    email_confirm: true,
    user_metadata: { full_name: "Wanda Wright" },
  });
  if (user.error || !user.data.user) throw new Error(user.error?.message);
  userIds.push(user.data.user.id);
  const membership = await admin.from("organisation_memberships").insert({
    organisation_id: orgId,
    user_id: user.data.user.id,
    role: "client_admin",
    status: "active",
  });
  if (membership.error) throw new Error(membership.error.message);

  const cust = await admin
    .from("customers")
    .insert({ organisation_id: orgId, name: `Dockside ${run}` })
    .select("id")
    .single();
  if (cust.error) throw new Error(cust.error.message);
  custId = cust.data.id;
});

test.afterAll(async () => {
  await admin.from("audit_log").delete().eq("organisation_id", orgId);
  await admin.from("jobs").delete().eq("organisation_id", orgId);
  await admin.from("job_series").delete().eq("organisation_id", orgId);
  await admin.from("organisations").delete().eq("id", orgId);
  await admin.from("plans").delete().eq("id", planId);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(emailFor("write"));
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/);
}

test("create a recurring job, see the indicator, the scope picker and the delete scopes", async ({
  page,
}) => {
  await signIn(page);
  const title = `Weekly inspection ${run}`;

  // Create with Repeats on: weekly, ending after 4 occurrences.
  await page.goto(`/app/${slugA}/jobs/new`);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Customer").selectOption(custId);
  await page.getByLabel("Scheduled start").fill("2030-05-06T09:00");
  await page.getByLabel("Repeats").check();
  await page.getByLabel("Frequency").selectOption("weekly");
  await page.getByRole("radio", { name: "After" }).check();
  await page.getByLabel("Occurrences").fill("4");
  await page.getByRole("button", { name: "Create job" }).click();

  // Lands on an occurrence whose detail shows the recurrence rule.
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/jobs/[0-9a-f-]+$`));
  await expect(
    page.getByRole("heading", { name: title, level: 1 })
  ).toBeVisible();
  await expect(page.getByText(/Repeats:/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recurrence" })
  ).toBeVisible();

  // The list shows the occurrences with the recurrence indicator.
  await page.goto(`/app/${slugA}/jobs`);
  await expect(page.getByText(title).first()).toBeVisible();
  expect(await page.getByLabel("Recurring").count()).toBeGreaterThan(0);

  // The edit form offers the three-way scope picker.
  await page.getByText(title).first().click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/jobs/[0-9a-f-]+$`));
  const detailUrl = page.url();
  await page.goto(`${detailUrl}/edit`);
  await expect(page.getByText("Apply changes to")).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "This occurrence only" })
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "This and all following" })
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "The entire series" })
  ).toBeVisible();

  // The delete dialog on the detail offers the three scopes.
  await page.goto(detailUrl);
  await page.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByText("This occurrence only", { exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByText("This and all following", { exact: true })
  ).toBeVisible();
  await expect(
    dialog.getByText("The entire series", { exact: true })
  ).toBeVisible();
});

test("editing the schedule time under 'the entire series' re-times the occurrences", async ({
  page,
}) => {
  await signIn(page);
  const title = `Retime via form ${run}`;

  // Create weekly at 07:30, ending after 3.
  await page.goto(`/app/${slugA}/jobs/new`);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Customer").selectOption(custId);
  await page.getByLabel("Scheduled start").fill("2030-06-02T07:30");
  await page.getByLabel("Repeats").check();
  await page.getByLabel("Frequency").selectOption("weekly");
  await page.getByRole("radio", { name: "After" }).check();
  await page.getByLabel("Occurrences").fill("3");
  await page.getByRole("button", { name: "Create job" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/jobs/[0-9a-f-]+$`));
  const detailUrl = page.url();
  const jobId = detailUrl.split("/").pop()!;

  const { data: jobRow } = await admin
    .from("jobs")
    .select("series_id")
    .eq("id", jobId)
    .single();
  const seriesId = jobRow!.series_id as string;
  const allAtHour = async (hour: number, count: number) => {
    const { data } = await admin
      .from("jobs")
      .select("scheduled_start")
      .eq("series_id", seriesId);
    return (
      (data?.length ?? 0) === count &&
      (data ?? []).every(
        (r) => new Date(r.scheduled_start as string).getUTCHours() === hour
      )
    );
  };
  expect(await allAtHour(7, 3)).toBe(true);

  // Edit the schedule time to 08:00 under the entire-series scope.
  await page.goto(`${detailUrl}/edit`);
  await page.getByLabel("Scheduled start").fill("2030-06-02T08:00");
  await page.getByRole("radio", { name: "The entire series" }).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/jobs/[0-9a-f-]+$`));

  // All three occurrences re-timed to 08:00 (same count, dates preserved).
  await expect.poll(async () => allAtHour(8, 3)).toBe(true);
});
