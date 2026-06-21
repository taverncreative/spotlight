// Tasks screen test for Pass 6C. Runs with:
// npm run test:tasks-screen
//
// Drives the Tasks area through a real browser. A write-capable user sees the
// seeded tasks, narrows them with the status, assignee and overdue filters, and
// creates, edits, changes the status of and deletes a task. The Tasks sidebar
// entry shows in an organisation with the tasks module and is absent in one
// without it. A read_only user sees the list and filters but none of the
// create, edit, status or delete controls.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `ts-a-${run}`;
const slugN = `ts-n-${run}`;
const emailFor = (label: string) => `${label}-${run}@tasks-screen.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
const planIds: string[] = [];
let writeUserId: string;
const taskTitles = {
  openMine: `Open mine ${run}`,
  inProgressMine: `In progress mine ${run}`,
  overdue: `Overdue unassigned ${run}`,
  done: `Done mine ${run}`,
  unassigned: `Unassigned open ${run}`,
};

const HOUR = 60 * 60 * 1000;
const past = () => new Date(Date.now() - 48 * HOUR).toISOString();
const future = () => new Date(Date.now() + 48 * HOUR).toISOString();

async function makePlan(modules: string[], orgLabel: string) {
  const plan = await admin
    .from("plans")
    .insert({ key: `ts-${orgLabel}-${run}`, name: "TS", monthly_price_pence: 1000 })
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
  return user.data.user.id;
}

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["n", slugN],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Tasks Screen ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  // A has tasks (and customers, harmless); N has leads only, so it is a valid
  // workspace whose sidebar must not show Tasks.
  await makePlan(["tasks", "customers"], "a");
  await makePlan(["leads"], "n");

  // The write user belongs to both organisations; the read user to A only.
  writeUserId = await makeUser("write", [
    ["a", "staff"],
    ["n", "staff"],
  ]);
  await makeUser("read", [["a", "read_only"]]);

  const seed = await admin.from("tasks").insert([
    {
      organisation_id: orgIds.a,
      title: taskTitles.openMine,
      status: "open",
      due_at: future(),
      assigned_to: writeUserId,
    },
    {
      organisation_id: orgIds.a,
      title: taskTitles.inProgressMine,
      status: "in_progress",
      due_at: future(),
      assigned_to: writeUserId,
    },
    {
      organisation_id: orgIds.a,
      title: taskTitles.overdue,
      status: "open",
      due_at: past(),
      assigned_to: null,
    },
    {
      organisation_id: orgIds.a,
      title: taskTitles.done,
      status: "done",
      due_at: past(),
      assigned_to: writeUserId,
    },
    {
      organisation_id: orgIds.a,
      title: taskTitles.unassigned,
      status: "open",
      due_at: null,
      assigned_to: null,
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
  // The write user belongs to two organisations, so sign-in lands on the
  // workspace chooser at /app; the read user lands on /app/<slug>. Match both,
  // then each test navigates to the organisation it needs.
  await expect(page).toHaveURL(/\/app(\/|$)/);
}

test("the list shows the tasks and the status, assignee and overdue filters narrow them", async ({
  page,
}) => {
  await signIn(page, "write");
  await page.goto(`/app/${slugA}/tasks`);

  // The seeded tasks are listed.
  await expect(page.getByText(taskTitles.openMine)).toBeVisible();
  await expect(page.getByText(taskTitles.overdue)).toBeVisible();
  await expect(page.getByText(taskTitles.done)).toBeVisible();

  // Status filter: Done shows only the done task.
  await page.getByRole("link", { name: "Done", exact: true }).click();
  await expect(page.getByText(taskTitles.done)).toBeVisible();
  await expect(page.getByText(taskTitles.openMine)).toHaveCount(0);

  // Assignee filter: Me shows the write user's tasks, not the unassigned ones.
  await page.goto(`/app/${slugA}/tasks?assignee=me`);
  await expect(page.getByText(taskTitles.openMine)).toBeVisible();
  await expect(page.getByText(taskTitles.overdue)).toHaveCount(0);

  // Overdue filter: only the past-due open task.
  await page.goto(`/app/${slugA}/tasks`);
  await page.getByRole("link", { name: "Overdue", exact: true }).click();
  await expect(page.getByText(taskTitles.overdue)).toBeVisible();
  await expect(page.getByText(taskTitles.openMine)).toHaveCount(0);
  await expect(page.getByText(taskTitles.done)).toHaveCount(0);
});

test("a write user can create, edit, change the status of and delete a task", async ({
  page,
}) => {
  await signIn(page, "write");
  await page.goto(`/app/${slugA}/tasks`);

  // Create.
  const title = `Created ${run}`;
  await page.getByRole("link", { name: "New task" }).click();
  await expect(page).toHaveURL(/\/tasks\/new$/);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Assignee").selectOption(writeUserId);
  await page.getByLabel("Status").selectOption("open");
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/tasks$`));
  await expect(page.getByText(title)).toBeVisible();

  // Edit the title.
  const edited = `Edited ${run}`;
  const row = () => page.locator("tr", { hasText: title });
  await row().getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.getByLabel("Title").fill(edited);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/tasks$`));
  await expect(page.getByText(edited)).toBeVisible();

  // Quick status control: mark it done, the badge follows.
  const editedRow = page.locator("tr", { hasText: edited });
  await editedRow.getByRole("button", { name: "Done" }).click();
  await expect(editedRow.getByText("Done")).toBeVisible();

  // Delete behind the permanent-delete confirm.
  await editedRow.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete task" }).click();
  await expect(page.getByText(edited)).toHaveCount(0);
});

test("the Tasks sidebar entry shows only when the module is enabled", async ({
  page,
}) => {
  await signIn(page, "write");
  const sidebar = page.getByRole("navigation", { name: "Modules" });

  await page.goto(`/app/${slugA}`);
  await expect(sidebar.getByRole("link", { name: "Tasks" })).toBeVisible();

  await page.goto(`/app/${slugN}`);
  await expect(sidebar.getByRole("link", { name: "Leads" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Tasks" })).toHaveCount(0);
});

test("a read_only user sees the list and filters but none of the controls", async ({
  page,
}) => {
  await signIn(page, "read");
  await page.goto(`/app/${slugA}/tasks`);

  // The list and the filters are present.
  await expect(page.getByText(taskTitles.openMine)).toBeVisible();
  await expect(page.getByRole("link", { name: "Overdue", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Done", exact: true })).toBeVisible();

  // None of the write controls.
  await expect(page.getByRole("link", { name: "New task" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reopen" })).toHaveCount(0);
});
