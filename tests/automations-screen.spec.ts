// Automations screen test for Pass 10C. Runs with: npm run test:automations-screen
//
// Drives the Automations management screen through a real browser. Organisation A
// has the automations module; organisation N does not. It proves: the page lists
// the catalogue with each automation's state, and shows a not-yet-runnable type
// as coming soon with no enable control; a client_admin enables the runnable
// automation and configures its title, due days and assignee, and the change
// persists; a non-admin member sees the catalogue and states but none of the
// toggle or config controls; and the Automations sidebar entry shows when the
// module is enabled and is absent when not.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `asc-a-${run}`;
const slugN = `asc-n-${run}`;
const emailFor = (label: string) => `${label}-${run}@automations-screen.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
const planIds: string[] = [];
let memberAId: string;

async function makePlan(label: string, modules: string[]) {
  const plan = await admin
    .from("plans")
    .insert({ key: `asc-${label}-${run}`, name: "ASC", monthly_price_pence: 1000 })
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
  return user.data.user.id;
}

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["n", slugN],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Automations Screen ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  await makePlan("a", ["automations"]);
  await makePlan("n", ["leads"]); // no automations module

  // The admin belongs to both organisations (so the sidebar test can compare);
  // the member is a non-admin in A who also appears in the assignee picker.
  await makeUser("admin", [
    ["a", "client_admin"],
    ["n", "client_admin"],
  ]);
  memberAId = await makeUser("member", [["a", "staff"]]);
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

function card(page: Page, name: string) {
  return page.getByRole("region", { name });
}

test("the page lists the catalogue with states and a not-yet-runnable type as coming soon", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto(`/app/${slugA}/automations`);

  await expect(page.getByRole("heading", { name: "Automations", level: 1 })).toBeVisible();

  // The runnable automation is listed, inactive to begin with, with its trigger
  // and action in plain language.
  const followup = card(page, "Lead follow-up task");
  await expect(followup.getByText("Inactive", { exact: true })).toBeVisible();
  await expect(followup.getByText("When a lead is created")).toBeVisible();
  await expect(followup.getByText("Create a task")).toBeVisible();

  // The not-yet-runnable type shows coming soon and offers no enable control.
  const email = card(page, "Lead acknowledgement email");
  await expect(email.getByText("Coming soon", { exact: true })).toBeVisible();
  await expect(email.getByRole("button", { name: "Enable" })).toHaveCount(0);
  await expect(email.getByRole("button", { name: "Disable" })).toHaveCount(0);
});

test("a client_admin enables an automation and configures it, and the change persists", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto(`/app/${slugA}/automations`);

  const followup = card(page, "Lead follow-up task");

  // Enable: the state badge flips to Active and the toggle becomes Disable.
  await followup.getByRole("button", { name: "Enable" }).click();
  await expect(followup.getByText("Active", { exact: true })).toBeVisible();
  await expect(followup.getByRole("button", { name: "Disable" })).toBeVisible();

  // Configure the title, due days and assignee.
  await followup.getByLabel("Task title").fill("Call within a day");
  await followup.getByLabel("Days until due").fill("1");
  await followup.getByLabel("Assignee").selectOption(memberAId);
  await followup.getByRole("button", { name: "Save settings" }).click();

  // It persisted: the stored row is enabled with the configured settings.
  await expect(async () => {
    const row = await admin
      .from("org_automations")
      .select("enabled, config")
      .eq("organisation_id", orgIds.a)
      .eq("automation_type", "lead_followup_task")
      .single();
    expect(row.data?.enabled).toBe(true);
    const config = row.data?.config as Record<string, unknown>;
    expect(config.task_title).toBe("Call within a day");
    expect(config.days_until_due).toBe(1);
    expect(config.assignee_id).toBe(memberAId);
  }).toPass();

  // And it survives a reload (the form shows the saved values).
  await page.reload();
  await expect(card(page, "Lead follow-up task").getByLabel("Task title")).toHaveValue(
    "Call within a day"
  );
});

test("a non-admin member sees the catalogue and states but none of the controls", async ({
  page,
}) => {
  await signIn(page, "member");
  await page.goto(`/app/${slugA}/automations`);

  // The catalogue and states are visible (the transparency surface).
  await expect(card(page, "Lead follow-up task")).toBeVisible();
  await expect(card(page, "Lead acknowledgement email").getByText("Coming soon", { exact: true })).toBeVisible();

  // None of the management controls.
  await expect(page.getByRole("button", { name: "Enable" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Disable" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save settings" })).toHaveCount(0);
  await expect(page.getByLabel("Task title")).toHaveCount(0);
});

test("the Automations sidebar entry shows only when the module is enabled", async ({
  page,
}) => {
  await signIn(page, "admin");
  const sidebar = page.getByRole("navigation", { name: "Modules" });

  await page.goto(`/app/${slugA}`);
  await expect(sidebar.getByRole("link", { name: "Automations" })).toBeVisible();

  await page.goto(`/app/${slugN}`);
  await expect(sidebar.getByRole("link", { name: "Leads" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Automations" })).toHaveCount(0);
});
