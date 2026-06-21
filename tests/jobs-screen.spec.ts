// Jobs screen test for Phase 2, Pass 1. Runs with: npm run test:jobs-screen
//
// Proves the list, detail and form work end to end: a write user creates a job
// from the form, schedules it on the detail and starts it; create-from-quote on a
// quote detail pre-fills and links a job; the Jobs sidebar entry shows only when
// the jobs module is enabled and a non-entitled workspace redirects away; and a
// read_only user sees the list but none of the write controls.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `js-a-${run}`;
const slugN = `js-n-${run}`;
const emailFor = (label: string) => `${label}-${run}@jobs-screen.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
const planIds: string[] = [];
let writeUserId: string;
let custAId: string;
let siteAId: string;
let quoteAId: string;

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
      .insert({ name: `Jobs Screen ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }
  await assignPlan(orgIds.a, `js-a-${run}`, [
    "leads",
    "customers",
    "quotes",
    "jobs",
  ]);
  await assignPlan(orgIds.n, `js-n-${run}`, ["leads"]);

  for (const [label, orgLabel, role] of [
    ["write", "a", "client_admin"],
    ["read", "a", "read_only"],
  ] as const) {
    const user = await admin.auth.admin.createUser({
      email: emailFor(label),
      password,
      email_confirm: true,
      user_metadata: { full_name: label === "write" ? "Wendy Wright" : "Rhys Read" },
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
  // The write user is also a member of organisation N (no jobs), for the
  // sidebar-entitlement check.
  const memN = await admin.from("organisation_memberships").insert({
    organisation_id: orgIds.n,
    user_id: writeUserId,
    role: "client_admin",
    status: "active",
  });
  if (memN.error) throw new Error(memN.error.message);

  const cust = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.a, name: `Harbour ${run}` })
    .select("id")
    .single();
  if (cust.error) throw new Error(cust.error.message);
  custAId = cust.data.id;

  const site = await admin
    .from("sites")
    .insert({ organisation_id: orgIds.a, customer_id: custAId, name: `Chatham yard ${run}` })
    .select("id")
    .single();
  if (site.error) throw new Error(site.error.message);
  siteAId = site.data.id;

  const quote = await admin
    .from("quotes")
    .insert({
      organisation_id: orgIds.a,
      customer_id: custAId,
      site_id: siteAId,
      quote_number: 9201,
      title: `Gantry refurb ${run}`,
    })
    .select("id")
    .single();
  if (quote.error) throw new Error(quote.error.message);
  quoteAId = quote.data.id;
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

test("a write user creates a job, schedules it on the detail, and starts it", async ({
  page,
}) => {
  await signIn(page, "write");
  await page.goto(`/app/${slugA}/jobs`);

  const title = `Site survey ${run}`;
  await page.getByRole("link", { name: "New job" }).click();
  await expect(page).toHaveURL(/\/jobs\/new$/);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Customer").selectOption(custAId);
  await page.getByLabel("Site").selectOption(siteAId);
  await page.getByRole("button", { name: "Create job" }).click();

  // Lands on the new job's detail, unscheduled.
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/jobs/[0-9a-f-]+$`));
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await expect(page.getByText("Unscheduled", { exact: true })).toBeVisible();

  // Schedule it: set a time and an assignee.
  await page.getByLabel("Scheduled start").fill("2026-08-01T09:00");
  await page.getByLabel("Assignee").selectOption(writeUserId);
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByText("Scheduled", { exact: true })).toBeVisible();

  // Start it from the status control.
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText("In progress", { exact: true })).toBeVisible();

  // It appears on the list.
  await page.goto(`/app/${slugA}/jobs`);
  await expect(page.getByText(title)).toBeVisible();
});

test("create-from-quote pre-fills a job and links it back to the quote", async ({
  page,
}) => {
  await signIn(page, "write");
  await page.goto(`/app/${slugA}/quotes/${quoteAId}`);

  await page.getByRole("button", { name: "Create job" }).click();
  // The confirm dialog's own Create job button.
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Create job" })
    .click();

  // Lands on the new job, carrying the quote's title and linking back to it.
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/jobs/[0-9a-f-]+$`));
  await expect(
    page.getByRole("heading", { name: `Gantry refurb ${run}`, level: 1 })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Quote #9201/ })
  ).toBeVisible();
});

test("the Jobs sidebar entry shows only when the module is enabled", async ({
  page,
}) => {
  await signIn(page, "write");
  const sidebar = page.getByRole("navigation", { name: "Modules" });

  await page.goto(`/app/${slugA}`);
  await expect(sidebar.getByRole("link", { name: "Jobs" })).toBeVisible();

  // Organisation N has no jobs entitlement: no nav entry, and a direct visit is
  // sent back to the overview.
  await page.goto(`/app/${slugN}`);
  await expect(sidebar.getByRole("link", { name: "Leads" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Jobs" })).toHaveCount(0);

  await page.goto(`/app/${slugN}/jobs`);
  await expect(page).toHaveURL(new RegExp(`/app/${slugN}$`));
});

test("a read_only user sees the list but none of the write controls", async ({
  page,
}) => {
  // Seed a job to view.
  const job = await admin
    .from("jobs")
    .insert({
      organisation_id: orgIds.a,
      customer_id: custAId,
      title: `Readable job ${run}`,
      status: "scheduled",
      scheduled_start: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (job.error) throw new Error(job.error.message);

  await signIn(page, "read");
  await page.goto(`/app/${slugA}/jobs`);

  await expect(page.getByText(`Readable job ${run}`)).toBeVisible();
  await expect(page.getByRole("link", { name: "New job" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);

  // The detail shows no schedule form or write actions.
  await page.goto(`/app/${slugA}/jobs/${job.data.id}`);
  await expect(
    page.getByRole("heading", { name: `Readable job ${run}`, level: 1 })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save schedule" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
});
