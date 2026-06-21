// Jobs scheduler week-view test for Phase 2, Pass 2. Runs with:
// npm run test:jobs-scheduler
//
// Proves the week view: scheduled jobs sit in the week grid and click through to
// their detail; the view toggle moves between the list and the week; week
// navigation (previous/next/this week) moves the displayed week; the assignee
// filter narrows the grid to one member; unscheduled jobs are surfaced as a rail
// linking to the list, not hidden; the jobs entitlement still gates the view; and
// a read_only user sees the grid but no New job action.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `jsc-a-${run}`;
const slugN = `jsc-n-${run}`;
const emailFor = (label: string) => `${label}-${run}@jobs-scheduler.test`;

// A fixed week well away from "now", driven entirely by the ?week= param, so the
// navigation assertions are deterministic. 2026-09-09 and 2026-09-10 share a
// Monday-start week; "next week" never contains them.
const WEEK_PARAM = "2026-09-09";
const startAlpha = "2026-09-09T09:00:00.000Z";
const startBeta = "2026-09-10T11:00:00.000Z";

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
const planIds: string[] = [];
let writeUserId: string;
let mateUserId: string;
let custAId: string;
const titleAlpha = `Grid alpha ${run}`;
const titleBeta = `Grid beta ${run}`;
const titleUnscheduled = `Loose job ${run}`;

async function assignPlan(orgId: string, key: string, modules: string[]) {
  const plan = await admin
    .from("plans")
    .insert({ key, name: key, monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planIds.push(plan.data.id);
  const linked = await admin
    .from("plan_modules")
    .insert(modules.map((module) => ({ plan_id: plan.data.id, module })));
  if (linked.error) throw new Error(linked.error.message);
  const assigned = await admin.rpc("assign_plan", {
    org_id: orgId,
    new_plan_id: plan.data.id,
  });
  if (assigned.error) throw new Error(assigned.error.message);
}

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["n", slugN],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Jobs Scheduler ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }
  await assignPlan(orgIds.a, `jsc-a-${run}`, ["leads", "customers", "jobs"]);
  await assignPlan(orgIds.n, `jsc-n-${run}`, ["leads"]);

  for (const [label, role, fullName] of [
    ["write", "client_admin", "Wendy Wright"],
    ["mate", "staff", "Sam Stone"],
    ["read", "read_only", "Rhys Read"],
  ] as const) {
    const user = await admin.auth.admin.createUser({
      email: emailFor(label),
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (user.error || !user.data.user) throw new Error(user.error?.message);
    userIds.push(user.data.user.id);
    if (label === "write") writeUserId = user.data.user.id;
    if (label === "mate") mateUserId = user.data.user.id;
    const membership = await admin.from("organisation_memberships").insert({
      organisation_id: orgIds.a,
      user_id: user.data.user.id,
      role,
      status: "active",
    });
    if (membership.error) throw new Error(membership.error.message);
  }
  // The write user is also a member of organisation N (no jobs), for the
  // entitlement-gate redirect.
  const memN = await admin.from("organisation_memberships").insert({
    organisation_id: orgIds.n,
    user_id: writeUserId,
    role: "client_admin",
    status: "active",
  });
  if (memN.error) throw new Error(memN.error.message);

  const cust = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.a, name: `Quayside ${run}` })
    .select("id")
    .single();
  if (cust.error) throw new Error(cust.error.message);
  custAId = cust.data.id;

  const jobs = await admin.from("jobs").insert([
    {
      organisation_id: orgIds.a,
      customer_id: custAId,
      title: titleAlpha,
      status: "scheduled",
      scheduled_start: startAlpha,
      assigned_to: writeUserId,
    },
    {
      organisation_id: orgIds.a,
      customer_id: custAId,
      title: titleBeta,
      status: "scheduled",
      scheduled_start: startBeta,
      assigned_to: mateUserId,
    },
    {
      organisation_id: orgIds.a,
      customer_id: custAId,
      title: titleUnscheduled,
      status: "unscheduled",
      scheduled_start: null,
      assigned_to: null,
    },
  ]);
  if (jobs.error) throw new Error(jobs.error.message);
});

test.afterAll(async () => {
  const ids = Object.values(orgIds);
  await admin.from("audit_log").delete().in("organisation_id", ids);
  await admin.from("jobs").delete().in("organisation_id", ids);
  await admin.from("organisations").delete().in("id", ids);
  await admin.from("plans").delete().in("id", planIds);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
});

async function signIn(page: Page, label: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(emailFor(label));
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/);
}

test("the week view shows the week's scheduled jobs and clicks through to a detail", async ({
  page,
}) => {
  await signIn(page, "write");

  // The List/Week toggle reaches the scheduler.
  await page.goto(`/app/${slugA}/jobs`);
  await page.getByRole("tab", { name: "Week" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/jobs/schedule$`));

  await page.goto(`/app/${slugA}/jobs/schedule?week=${WEEK_PARAM}`);
  await expect(page.getByText(titleAlpha)).toBeVisible();
  await expect(page.getByText(titleBeta)).toBeVisible();
  // The week range is shown.
  await expect(page.getByText(/September 2026/)).toBeVisible();
  // New job is available to a writer.
  await expect(page.getByRole("link", { name: "New job" })).toBeVisible();

  // Clicking a job opens its detail.
  await page.getByText(titleAlpha).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/jobs/[0-9a-f-]+$`));
  await expect(
    page.getByRole("heading", { name: titleAlpha, level: 1 })
  ).toBeVisible();
});

test("week navigation moves the displayed week", async ({ page }) => {
  await signIn(page, "write");
  await page.goto(`/app/${slugA}/jobs/schedule?week=${WEEK_PARAM}`);
  await expect(page.getByText(titleAlpha)).toBeVisible();

  // Next week no longer contains the jobs.
  await page.getByRole("link", { name: "Next week" }).click();
  await expect(page.getByText(titleAlpha)).toHaveCount(0);

  // Back to the original week brings them back.
  await page.getByRole("link", { name: "Previous week" }).click();
  await expect(page.getByText(titleAlpha)).toBeVisible();

  // This week returns to the current week (the param drops away).
  await page.getByRole("link", { name: "This week" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/jobs/schedule$`));
});

test("the assignee filter narrows the week to one member", async ({ page }) => {
  await signIn(page, "write");
  await page.goto(`/app/${slugA}/jobs/schedule?week=${WEEK_PARAM}`);

  // Filter to Sam Stone: only their job remains, and the week is preserved.
  // exact: true picks the filter pill, not a job card whose accessible name
  // happens to include the assignee.
  await page.getByRole("link", { name: "Sam Stone", exact: true }).click();
  await expect(page).toHaveURL(/assignee=/);
  await expect(page.getByText(titleBeta)).toBeVisible();
  await expect(page.getByText(titleAlpha)).toHaveCount(0);

  // All assignees brings both back.
  await page.getByRole("link", { name: "All assignees" }).click();
  await expect(page.getByText(titleAlpha)).toBeVisible();
  await expect(page.getByText(titleBeta)).toBeVisible();
});

test("unscheduled jobs are surfaced as a rail to the list, not hidden", async ({
  page,
}) => {
  await signIn(page, "write");
  await page.goto(`/app/${slugA}/jobs/schedule?week=${WEEK_PARAM}`);

  // The unscheduled job is not in the grid, but the rail links to the list
  // filtered to unscheduled jobs.
  await expect(page.getByText(titleUnscheduled)).toHaveCount(0);
  const rail = page.getByRole("link", { name: /unscheduled/ });
  await expect(rail).toBeVisible();
  await rail.click();
  await expect(page).toHaveURL(/\/jobs\?status=unscheduled/);
  await expect(page.getByText(titleUnscheduled)).toBeVisible();
});

test("the jobs entitlement gates the scheduler, and read_only sees no write action", async ({
  page,
}) => {
  await signIn(page, "write");
  // Organisation N has no jobs entitlement: a direct visit is sent back to the
  // overview.
  await page.goto(`/app/${slugN}/jobs/schedule`);
  await expect(page).toHaveURL(new RegExp(`/app/${slugN}$`));

  // A read_only member sees the grid but no New job action.
  await signIn(page, "read");
  await page.goto(`/app/${slugA}/jobs/schedule?week=${WEEK_PARAM}`);
  await expect(page.getByText(titleAlpha)).toBeVisible();
  await expect(page.getByRole("link", { name: "New job" })).toHaveCount(0);
});
