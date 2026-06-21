// Dashboard test for Phase 12. Runs with: npm run test:dashboard
//
// Drives the workspace home (the read-only dashboard) through a real browser.
// Organisation A has every dashboard module and is seeded with a known mix of
// leads, customers, quotes, tasks and savings; the test asserts each card's
// figure against the seeded data, and that the needs-attention area lists the
// right overdue tasks and unanswered (sent) quotes. A read_only member sees the
// same full dashboard. Organisation B lacks the quotes module, so its Quotes
// card is absent. Expected figures are derived from the seed (the savings total
// with the same helper the page uses), so the assertions cannot drift.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { computeSavingsTotals, type Cadence } from "../lib/savings/totals";
import { formatPence } from "../lib/currency";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `dash-a-${run}`;
const slugB = `dash-b-${run}`;
const emailFor = (label: string) => `${label}-${run}@dashboard.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
const planIds: string[] = [];

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// The seeded savings mix and its monthly total, computed with the production
// helper so the page and the test can never disagree.
const savingsMix: { amount_pence: number; cadence: Cadence }[] = [
  { amount_pence: 1500, cadence: "monthly" },
  { amount_pence: 6000, cadence: "annual" },
  { amount_pence: 100, cadence: "annual" },
];
const savingsMonthly = computeSavingsTotals(savingsMix).monthlyTotalPence;

// The expected figures for organisation A, derived from the seed below.
const expected = {
  leadsOpen: 4, // new + contacted + qualified + an older new (not converted/rejected/deleted)
  leadsLast7: 5, // every non-deleted lead created in the last 7 days
  customers: 3, // three active, one soft-deleted excluded
  quotesOpen: 3, // two sent + one draft (not accepted/declined/deleted)
  quotesValuePence: 175000, // 100000 + 50000 + 25000
  quotesAccepted30: 1, // one accepted updated within 30 days; an older one excluded
  tasksOpen: 4, // two overdue + one future + one with no due date
  tasksOverdue: 2, // two past due, still open/in progress
};

async function makePlan(modules: string[], orgLabel: string) {
  const plan = await admin
    .from("plans")
    .insert({ key: `dash-${orgLabel}-${run}`, name: "DASH", monthly_price_pence: 1000 })
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
    org_id: orgIds[orgLabel],
    new_plan_id: plan.data.id,
  });
  if (assigned.error) throw new Error(assigned.error.message);
}

async function makeUser(label: string, memberships: Array<[string, string]>) {
  const user = await admin.auth.admin.createUser({
    email: emailFor(label),
    password,
    email_confirm: true,
  });
  if (user.error || !user.data.user) throw new Error(user.error?.message);
  userIds.push(user.data.user.id);
  for (const [orgLabel, role] of memberships) {
    const membership = await admin.from("organisation_memberships").insert({
      organisation_id: orgIds[orgLabel],
      user_id: user.data.user.id,
      role,
      status: "active",
    });
    if (membership.error) throw new Error(membership.error.message);
  }
}

async function insert(table: string, rows: Record<string, unknown>[]) {
  const result = await admin.from(table).insert(rows);
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
}

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["b", slugB],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Dashboard ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  // A has every dashboard module; B lacks quotes (so B's Quotes card is absent).
  await makePlan(
    ["leads", "customers", "quotes", "tasks", "subscription_savings"],
    "a"
  );
  await makePlan(["leads", "customers", "tasks", "subscription_savings"], "b");

  await makeUser("write", [["a", "staff"]]);
  await makeUser("read", [["a", "read_only"]]);
  await makeUser("bwrite", [["b", "staff"]]);

  const a = orgIds.a;

  // Customers: three active, one soft-deleted.
  const customers = await admin
    .from("customers")
    .insert([
      { organisation_id: a, name: `Cust One ${run}`, type: "business" },
      { organisation_id: a, name: `Cust Two ${run}`, type: "business" },
      { organisation_id: a, name: `Cust Three ${run}`, type: "individual" },
      {
        organisation_id: a,
        name: `Cust Deleted ${run}`,
        type: "business",
        deleted_at: daysAgo(1),
      },
    ])
    .select("id");
  if (customers.error) throw new Error(customers.error.message);
  const customerAId = customers.data[0].id;

  // Leads: 4 open (new, contacted, qualified, plus an older new), 2 closed
  // (converted, rejected) created recently, 1 deleted. open = 4; last 7 days = 5
  // (the three new-ish open plus the two closed, all created now).
  await insert("leads", [
    { organisation_id: a, name: `Lead new ${run}`, status: "new", created_at: daysAgo(0) },
    { organisation_id: a, name: `Lead contacted ${run}`, status: "contacted", created_at: daysAgo(1) },
    { organisation_id: a, name: `Lead qualified ${run}`, status: "qualified", created_at: daysAgo(2) },
    { organisation_id: a, name: `Lead old open ${run}`, status: "new", created_at: daysAgo(20) },
    { organisation_id: a, name: `Lead converted ${run}`, status: "converted", created_at: daysAgo(1) },
    { organisation_id: a, name: `Lead rejected ${run}`, status: "rejected", created_at: daysAgo(2) },
    { organisation_id: a, name: `Lead deleted ${run}`, status: "new", created_at: daysAgo(0), deleted_at: daysAgo(0) },
  ]);

  // Quotes (all on the first active customer): one draft and two sent are open
  // (value 100000 + 50000 + 25000 = 175000); one accepted updated within 30
  // days counts as recently accepted, an older accepted one does not; a declined
  // and a soft-deleted draft count for nothing.
  // updated_at is set on every row: a PostgREST bulk insert fills any key missing
  // from one row with NULL rather than the column default, and updated_at is NOT
  // NULL (the same gotcha as the is_primary lesson). It also stands in for the
  // acceptance time, so the recent acceptance is within 30 days and the old one
  // is not.
  await insert("quotes", [
    { organisation_id: a, customer_id: customerAId, quote_number: 1, title: `Draft job ${run}`, status: "draft", issued_at: null, total_pence: 100000, updated_at: daysAgo(0) },
    { organisation_id: a, customer_id: customerAId, quote_number: 2, title: `Sent job two ${run}`, status: "sent", issued_at: daysAgo(1), total_pence: 50000, updated_at: daysAgo(1) },
    { organisation_id: a, customer_id: customerAId, quote_number: 3, title: `Sent job three ${run}`, status: "sent", issued_at: daysAgo(2), total_pence: 25000, updated_at: daysAgo(2) },
    { organisation_id: a, customer_id: customerAId, quote_number: 4, title: `Accepted recent ${run}`, status: "accepted", issued_at: daysAgo(5), total_pence: 200000, updated_at: daysAgo(3) },
    { organisation_id: a, customer_id: customerAId, quote_number: 5, title: `Accepted old ${run}`, status: "accepted", issued_at: daysAgo(45), total_pence: 60000, updated_at: daysAgo(40) },
    { organisation_id: a, customer_id: customerAId, quote_number: 6, title: `Declined job ${run}`, status: "declined", issued_at: daysAgo(5), total_pence: 9999, updated_at: daysAgo(4) },
    { organisation_id: a, customer_id: customerAId, quote_number: 7, title: `Deleted draft ${run}`, status: "draft", issued_at: null, total_pence: 999999, updated_at: daysAgo(0), deleted_at: daysAgo(1) },
  ]);

  // Tasks: two overdue (past due, still open/in progress), one due in the future,
  // one with no due date, one done and one cancelled. open = 4; overdue = 2.
  await insert("tasks", [
    { organisation_id: a, title: `Overdue alpha ${run}`, status: "open", due_at: daysAgo(2) },
    { organisation_id: a, title: `Overdue beta ${run}`, status: "in_progress", due_at: daysAgo(1) },
    { organisation_id: a, title: `Future task ${run}`, status: "open", due_at: daysAgo(-5) },
    { organisation_id: a, title: `No due date ${run}`, status: "open", due_at: null },
    { organisation_id: a, title: `Done task ${run}`, status: "done", due_at: daysAgo(3) },
    { organisation_id: a, title: `Cancelled task ${run}`, status: "cancelled", due_at: daysAgo(1) },
  ]);

  // Savings: the known mix, monthly total computed above.
  await insert(
    "savings_items",
    savingsMix.map((item, index) => ({
      organisation_id: a,
      label: `Saving ${index} ${run}`,
      amount_pence: item.amount_pence,
      cadence: item.cadence,
    }))
  );

  // Organisation B: one open lead and one customer, no quotes (no quotes module).
  await insert("customers", [
    { organisation_id: orgIds.b, name: `B customer ${run}`, type: "business" },
  ]);
  await insert("leads", [
    { organisation_id: orgIds.b, name: `B lead ${run}`, status: "new", created_at: daysAgo(0) },
  ]);
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

test("the dashboard shows the correct figures for every card", async ({ page }) => {
  await signIn(page, "write");
  await page.goto(`/app/${slugA}`);

  await expect(page.getByTestId("dash-leads-open")).toHaveText(String(expected.leadsOpen));
  await expect(page.getByTestId("dash-leads-last7")).toHaveText(String(expected.leadsLast7));
  await expect(page.getByTestId("dash-customers-total")).toHaveText(String(expected.customers));
  await expect(page.getByTestId("dash-quotes-open")).toHaveText(String(expected.quotesOpen));
  await expect(page.getByTestId("dash-quotes-value")).toHaveText(formatPence(expected.quotesValuePence));
  await expect(page.getByTestId("dash-quotes-accepted30")).toHaveText(String(expected.quotesAccepted30));
  await expect(page.getByTestId("dash-tasks-open")).toHaveText(String(expected.tasksOpen));
  await expect(page.getByTestId("dash-tasks-overdue")).toHaveText(String(expected.tasksOverdue));
  await expect(page.getByTestId("dash-savings-monthly")).toHaveText(formatPence(savingsMonthly));
});

test("the needs-attention area lists the overdue tasks and unanswered quotes", async ({
  page,
}) => {
  await signIn(page, "write");
  await page.goto(`/app/${slugA}`);

  const overdue = page.getByTestId("attention-overdue-tasks");
  await expect(overdue).toContainText(`Overdue alpha ${run}`);
  await expect(overdue).toContainText(`Overdue beta ${run}`);
  // The future, no-due-date, done and cancelled tasks are not overdue.
  await expect(overdue).not.toContainText(`Future task ${run}`);
  await expect(overdue).not.toContainText(`Done task ${run}`);

  const unanswered = page.getByTestId("attention-unanswered-quotes");
  await expect(unanswered).toContainText("Quote #2");
  await expect(unanswered).toContainText("Quote #3");
  // The accepted and declined quotes are not awaiting a response.
  await expect(unanswered).not.toContainText("Quote #4");
  await expect(unanswered).not.toContainText("Quote #6");

  // The attention groups link through to the filtered lists.
  await expect(
    overdue.getByRole("link", { name: "Overdue tasks" })
  ).toHaveAttribute("href", `/app/${slugA}/tasks?overdue=1`);
  await expect(
    unanswered.getByRole("link", { name: "Quotes awaiting a response" })
  ).toHaveAttribute("href", `/app/${slugA}/quotes?status=sent`);
});

test("a read_only member sees the full dashboard", async ({ page }) => {
  await signIn(page, "read");
  await page.goto(`/app/${slugA}`);

  await expect(page.getByTestId("dash-leads-open")).toHaveText(String(expected.leadsOpen));
  await expect(page.getByTestId("dash-quotes-value")).toHaveText(formatPence(expected.quotesValuePence));
  await expect(page.getByTestId("dash-tasks-overdue")).toHaveText(String(expected.tasksOverdue));
  await expect(page.getByTestId("attention-overdue-tasks")).toBeVisible();
});

test("a card for a module the workspace does not have is absent", async ({ page }) => {
  await signIn(page, "bwrite");
  await page.goto(`/app/${slugB}`);

  // B has leads, customers, tasks and savings, but not quotes.
  await expect(page.getByTestId("card-leads")).toBeVisible();
  await expect(page.getByTestId("card-customers")).toBeVisible();
  await expect(page.getByTestId("card-quotes")).toHaveCount(0);
  // With no quotes module there are no unanswered quotes in the attention area.
  await expect(page.getByTestId("attention-unanswered-quotes")).toHaveCount(0);
});
