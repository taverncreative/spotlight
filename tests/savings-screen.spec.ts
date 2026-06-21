// Savings screen test for Pass 11B. Runs with: npm run test:savings-screen
//
// Drives the Savings area through a real browser. The page leads with the total
// saving (monthly and annual), totalled live from the seeded items. A
// write-capable user adds an item and watches the total increase by the right
// amount, edits it, and deletes it behind the permanent-delete confirm with the
// total returning. The Savings sidebar entry shows in an organisation with the
// subscription_savings module and is absent in one without it. A read_only user
// sees the total and the list but none of the add, edit or delete controls. The
// expected totals are computed with the same helper the action uses, so the
// assertions cannot drift from the real total.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { computeSavingsTotals, type Cadence } from "../lib/savings/totals";
import { formatPence } from "../lib/currency";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `ssc-a-${run}`;
const slugN = `ssc-n-${run}`;
const emailFor = (label: string) => `${label}-${run}@savings-screen.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
const planIds: string[] = [];

const seeded = {
  oldCrm: `Old CRM seed ${run}`,
  emailTool: `Email tool seed ${run}`,
};

// The seeded mix and its totals, computed with the production helper so the
// page assertions and the seed never disagree.
const seedMix: { amount_pence: number; cadence: Cadence }[] = [
  { amount_pence: 4900, cadence: "monthly" },
  { amount_pence: 18000, cadence: "annual" },
];
const baseline = computeSavingsTotals(seedMix);

async function makePlan(modules: string[], orgLabel: string) {
  const plan = await admin
    .from("plans")
    .insert({ key: `ssc-${orgLabel}-${run}`, name: "SSC", monthly_price_pence: 1000 })
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

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["n", slugN],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Savings Screen ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  // A has subscription_savings; N has leads only, so it is a valid workspace
  // whose sidebar must not show Savings.
  await makePlan(["subscription_savings"], "a");
  await makePlan(["leads"], "n");

  // The write user belongs to both organisations; the read user to A only.
  await makeUser("write", [
    ["a", "staff"],
    ["n", "staff"],
  ]);
  await makeUser("read", [["a", "read_only"]]);

  const seed = await admin.from("savings_items").insert([
    {
      organisation_id: orgIds.a,
      label: seeded.oldCrm,
      amount_pence: 4900,
      cadence: "monthly",
      note: "Replaced by Relay.",
      cancelled_on: "2026-03-01",
    },
    {
      organisation_id: orgIds.a,
      label: seeded.emailTool,
      amount_pence: 18000,
      cadence: "annual",
    },
  ]);
  if (seed.error) throw new Error(seed.error.message);
});

test.afterAll(async () => {
  const ids = Object.values(orgIds);
  await admin.from("audit_log").delete().in("organisation_id", ids);
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

async function expectTotals(
  page: Page,
  totals: { monthlyTotalPence: number; annualTotalPence: number }
) {
  await expect(page.getByTestId("savings-monthly-total")).toHaveText(
    formatPence(totals.monthlyTotalPence)
  );
  await expect(page.getByTestId("savings-annual-total")).toHaveText(
    formatPence(totals.annualTotalPence)
  );
}

test("the page leads with the correct total and lists the items", async ({
  page,
}) => {
  await signIn(page, "write");
  await page.goto(`/app/${slugA}/savings`);

  await expect(page.getByRole("heading", { name: "Savings", level: 1 })).toBeVisible();
  await expectTotals(page, baseline);

  // Both seeded items are listed, with the amount and its cadence shown.
  const crmRow = page.locator("tr", { hasText: seeded.oldCrm });
  await expect(crmRow).toContainText("£49.00");
  await expect(crmRow).toContainText("per month");
  await expect(crmRow).toContainText("1 March 2026");
  const emailRow = page.locator("tr", { hasText: seeded.emailTool });
  await expect(emailRow).toContainText("£180.00");
  await expect(emailRow).toContainText("per year");
});

test("a write user adds, edits and deletes an item and the total updates", async ({
  page,
}) => {
  await signIn(page, "write");
  await page.goto(`/app/${slugA}/savings`);
  await expectTotals(page, baseline);

  const label = `Phone plan ${run}`;

  // Add a £20.00 per month item: the total rises by that, normalised.
  await page.getByRole("link", { name: "New item" }).click();
  await expect(page).toHaveURL(/\/savings\/new$/);
  await page.getByLabel("Label", { exact: true }).fill(label);
  await page.getByLabel("Amount in pounds").fill("20.00");
  await page.getByLabel("Cadence").selectOption("monthly");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/savings$`));
  await expect(page.getByText(label)).toBeVisible();
  const afterAdd = computeSavingsTotals([
    ...seedMix,
    { amount_pence: 2000, cadence: "monthly" },
  ]);
  await expectTotals(page, afterAdd);

  // Edit it to £25.00 per month: the total rises again to match.
  const row = () => page.locator("tr", { hasText: label });
  await row().getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(/\/edit$/);
  // The amount is pre-filled in pounds from the stored pence.
  await expect(page.getByLabel("Amount in pounds")).toHaveValue("20.00");
  await page.getByLabel("Amount in pounds").fill("25.00");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/savings$`));
  const afterEdit = computeSavingsTotals([
    ...seedMix,
    { amount_pence: 2500, cadence: "monthly" },
  ]);
  await expectTotals(page, afterEdit);

  // Delete behind the permanent-delete confirm: the total returns to baseline.
  await row().getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete item" }).click();
  await expect(page.getByText(label)).toHaveCount(0);
  await expectTotals(page, baseline);
});

test("the Savings sidebar entry shows only when the module is enabled", async ({
  page,
}) => {
  await signIn(page, "write");
  const sidebar = page.getByRole("navigation", { name: "Modules" });

  await page.goto(`/app/${slugA}`);
  await expect(sidebar.getByRole("link", { name: "Savings" })).toBeVisible();

  await page.goto(`/app/${slugN}`);
  await expect(sidebar.getByRole("link", { name: "Leads" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Savings" })).toHaveCount(0);
});

test("a read_only user sees the total and list but none of the controls", async ({
  page,
}) => {
  await signIn(page, "read");
  await page.goto(`/app/${slugA}/savings`);

  await expectTotals(page, baseline);
  await expect(page.getByText(seeded.oldCrm)).toBeVisible();
  await expect(page.getByText(seeded.emailTool)).toBeVisible();

  await expect(page.getByRole("link", { name: "New item" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
});
