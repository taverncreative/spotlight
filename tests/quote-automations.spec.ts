// Quote-lifecycle automations test for Pass 10D. Runs with:
// npm run test:quote-automations
//
// Proves a quote being accepted or declined fires its configured follow-up task
// exactly once, by every path that makes the transition. Organisation A has both
// quote automations enabled and configured; B has them enabled (for tenant
// isolation); D has the accepted one disabled; N has an enabled row but not the
// automations module. It shows: a customer accepting on the public page creates
// the configured task linked to the quote and one run; an in-app transition to
// accepted does the same and does not double-fire; a repeat fire for the same
// quote is a no-op; the same set for decline; a disabled type and an org without
// the module fire nothing; tenant isolation holds; and the management screen
// lists both new types.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const emailFor = (label: string) => `${label}-${run}@quote-automations.test`;
const DAY = 24 * 60 * 60 * 1000;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const slugs: Record<string, string> = {};
const customerIds: Record<string, string> = {};
const userIds: string[] = [];
const planIds: string[] = [];
let adminAId: string;
let nextQuoteNumber = 4000;

async function makePlan(label: string, modules: string[]) {
  const plan = await admin
    .from("plans")
    .insert({ key: `qa-${label}-${run}`, name: "QA", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planIds.push(plan.data.id);
  for (const moduleKey of modules) {
    const linked = await admin
      .from("plan_modules")
      .insert({ plan_id: plan.data.id, module: moduleKey });
    if (linked.error) throw new Error(linked.error.message);
  }
  const assigned = await admin.rpc("assign_plan", {
    org_id: orgIds[label],
    new_plan_id: plan.data.id,
  });
  if (assigned.error) throw new Error(assigned.error.message);
}

async function setAutomation(
  orgLabel: string,
  type: string,
  enabled: boolean,
  config: Record<string, unknown>
) {
  const res = await admin.from("org_automations").insert({
    organisation_id: orgIds[orgLabel],
    automation_type: type,
    enabled,
    config,
  });
  if (res.error) throw new Error(res.error.message);
}

async function createSentQuote(orgLabel: string) {
  const token = randomBytes(32).toString("base64url");
  const res = await admin
    .from("quotes")
    .insert({
      organisation_id: orgIds[orgLabel],
      customer_id: customerIds[orgLabel],
      quote_number: nextQuoteNumber++,
      status: "sent",
      public_token: token,
    })
    .select("id")
    .single();
  if (res.error) throw new Error(res.error.message);
  return { id: res.data.id as string, token };
}

type TaskRow = {
  id: string;
  title: string;
  due_at: string | null;
  assigned_to: string | null;
  created_by: string | null;
  related_type: string | null;
  related_id: string | null;
};

async function tasksForQuote(orgLabel: string, quoteId: string) {
  const { data } = await admin
    .from("tasks")
    .select("id, title, due_at, assigned_to, created_by, related_type, related_id")
    .eq("organisation_id", orgIds[orgLabel])
    .eq("related_type", "quote")
    .eq("related_id", quoteId);
  return (data as TaskRow[]) ?? [];
}

async function runsForQuote(orgLabel: string, quoteId: string, type: string) {
  const { data } = await admin
    .from("automation_runs")
    .select("id")
    .eq("organisation_id", orgIds[orgLabel])
    .eq("automation_type", type)
    .eq("related_type", "quote")
    .eq("related_id", quoteId);
  return data ?? [];
}

test.beforeAll(async () => {
  for (const label of ["a", "b", "d", "n"]) {
    const slug = `qa-${label}-${run}`;
    slugs[label] = slug;
    const org = await admin
      .from("organisations")
      .insert({ name: `Quote Automations ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;

    const customer = await admin
      .from("customers")
      .insert({ organisation_id: org.data.id, name: `Customer ${label} ${run}` })
      .select("id")
      .single();
    if (customer.error) throw new Error(customer.error.message);
    customerIds[label] = customer.data.id;
  }

  await makePlan("a", ["quotes", "automations"]);
  await makePlan("b", ["quotes", "automations"]);
  await makePlan("d", ["quotes", "automations"]);
  await makePlan("n", ["quotes"]); // no automations module

  const adminUser = await admin.auth.admin.createUser({
    email: emailFor("admin-a"),
    password,
    email_confirm: true,
  });
  if (adminUser.error || !adminUser.data.user) throw new Error(adminUser.error?.message);
  adminAId = adminUser.data.user.id;
  userIds.push(adminAId);
  const membership = await admin.from("organisation_memberships").insert({
    organisation_id: orgIds.a,
    user_id: adminAId,
    role: "client_admin",
    status: "active",
  });
  if (membership.error) throw new Error(membership.error.message);

  // A: both enabled; the accepted one has an assignee, the declined one does not.
  await setAutomation("a", "quote_accepted_task", true, {
    task_title: "Prepare the job",
    days_until_due: 3,
    assignee_id: adminAId,
  });
  await setAutomation("a", "quote_declined_task", true, {
    task_title: "Follow up the declined quote",
    days_until_due: 2,
  });
  // B: accepted enabled (tenant isolation).
  await setAutomation("b", "quote_accepted_task", true, {
    task_title: "B prepare",
    days_until_due: 1,
  });
  // D: accepted present but disabled.
  await setAutomation("d", "quote_accepted_task", false, {
    task_title: "Should not fire",
    days_until_due: 1,
  });
  // N: enabled row, but the organisation lacks the automations module.
  await setAutomation("n", "quote_accepted_task", true, {
    task_title: "No module",
    days_until_due: 1,
  });
});

test.afterAll(async () => {
  const ids = Object.values(orgIds);
  await admin.from("audit_log").delete().in("organisation_id", ids);
  await admin.from("quotes").delete().in("organisation_id", ids);
  await admin.from("organisations").delete().in("id", ids);
  await admin.from("plans").delete().in("id", planIds);
  for (const id of userIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

async function signIn(page: Page, label: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(emailFor(label));
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/);
}

async function publicAccept(page: Page, token: string) {
  await page.goto(`/q/${token}`);
  await page.getByRole("button", { name: "Accept quote" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Accept quote" })
    .click();
  await expect(page.getByText(/This quote was accepted/i)).toBeVisible();
}

async function publicDecline(page: Page, token: string) {
  await page.goto(`/q/${token}`);
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Decline quote" })
    .click();
  await expect(page.getByText(/This quote was declined/i)).toBeVisible();
}

async function inAppTransition(page: Page, slug: string, quoteId: string, to: string) {
  const response = await page.request.post(`/api/quotes-harness/${slug}`, {
    data: { action: "transitionQuoteStatus", input: { id: quoteId, to } },
  });
  return (await response.json()) as { data?: unknown };
}

test("a customer accepting on the public page fires the accepted task once", async ({
  page,
}) => {
  const quote = await createSentQuote("a");
  await publicAccept(page, quote.token);

  const tasks = await tasksForQuote("a", quote.id);
  expect(tasks).toHaveLength(1);
  expect(tasks[0].title).toBe("Prepare the job");
  expect(tasks[0].assigned_to).toBe(adminAId);
  expect(tasks[0].created_by).toBeNull();
  const due = new Date(tasks[0].due_at!).getTime();
  expect(Math.abs(due - (Date.now() + 3 * DAY))).toBeLessThan(60 * 60 * 1000);

  expect(await runsForQuote("a", quote.id, "quote_accepted_task")).toHaveLength(1);
});

test("an in-app transition to accepted fires once and a repeat fire is a no-op", async ({
  page,
}) => {
  const quote = await createSentQuote("a");
  await signIn(page, "admin-a");
  const result = await inAppTransition(page, slugs.a, quote.id, "accepted");
  expect(result.data).toBeTruthy();

  expect(await tasksForQuote("a", quote.id)).toHaveLength(1);
  expect(await runsForQuote("a", quote.id, "quote_accepted_task")).toHaveLength(1);

  // Firing the same quote's event again is a no-op (the unique key).
  const second = await admin.rpc("run_automation_create_task", {
    p_org_id: orgIds.a,
    p_automation_type: "quote_accepted_task",
    p_related_type: "quote",
    p_related_id: quote.id,
    p_task_title: "Prepare the job",
    p_days_until_due: 3,
    p_assignee_id: adminAId,
  });
  expect(second.error).toBeNull();
  expect(second.data).toBeNull();
  expect(await tasksForQuote("a", quote.id)).toHaveLength(1);
  expect(await runsForQuote("a", quote.id, "quote_accepted_task")).toHaveLength(1);
});

test("a customer declining on the public page fires the declined task once", async ({
  page,
}) => {
  const quote = await createSentQuote("a");
  await publicDecline(page, quote.token);

  const tasks = await tasksForQuote("a", quote.id);
  expect(tasks).toHaveLength(1);
  expect(tasks[0].title).toBe("Follow up the declined quote");
  expect(tasks[0].assigned_to).toBeNull();
  expect(await runsForQuote("a", quote.id, "quote_declined_task")).toHaveLength(1);
});

test("an in-app transition to declined fires once", async ({ page }) => {
  const quote = await createSentQuote("a");
  await signIn(page, "admin-a");
  const result = await inAppTransition(page, slugs.a, quote.id, "declined");
  expect(result.data).toBeTruthy();

  const tasks = await tasksForQuote("a", quote.id);
  expect(tasks).toHaveLength(1);
  expect(tasks[0].title).toBe("Follow up the declined quote");
  expect(await runsForQuote("a", quote.id, "quote_declined_task")).toHaveLength(1);
});

test("a disabled type and an organisation without the module fire nothing", async ({
  page,
}) => {
  const disabled = await createSentQuote("d");
  await publicAccept(page, disabled.token);
  expect(await tasksForQuote("d", disabled.id)).toHaveLength(0);
  expect(await runsForQuote("d", disabled.id, "quote_accepted_task")).toHaveLength(0);

  const noModule = await createSentQuote("n");
  await publicAccept(page, noModule.token);
  expect(await tasksForQuote("n", noModule.id)).toHaveLength(0);
  expect(await runsForQuote("n", noModule.id, "quote_accepted_task")).toHaveLength(0);
});

test("tenant isolation: a workspace's automation never fires against another's quote", async ({
  page,
}) => {
  const quoteA = await createSentQuote("a");
  const quoteB = await createSentQuote("b");
  await publicAccept(page, quoteB.token);

  // B's automation fired against B's quote, creating a task in B.
  expect(await tasksForQuote("b", quoteB.id)).toHaveLength(1);
  expect(await runsForQuote("b", quoteB.id, "quote_accepted_task")).toHaveLength(1);

  // No crossover.
  expect(await tasksForQuote("a", quoteB.id)).toHaveLength(0);
  expect(await runsForQuote("a", quoteB.id, "quote_accepted_task")).toHaveLength(0);
  expect(await tasksForQuote("b", quoteA.id)).toHaveLength(0);
  expect(await runsForQuote("b", quoteA.id, "quote_accepted_task")).toHaveLength(0);
});

test("the management screen lists the two new quote automation types", async ({ page }) => {
  await signIn(page, "admin-a");
  await page.goto(`/app/${slugs.a}/automations`);
  await expect(page.getByRole("region", { name: "Quote accepted task" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Quote declined task" })).toBeVisible();
});
