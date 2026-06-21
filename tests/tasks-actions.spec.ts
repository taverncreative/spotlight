// Tasks server-action test for Pass 6B. Runs with:
// npm run test:tasks-actions
//
// Exercises the real tasks actions through the harness route with real
// signed-in sessions per role. Organisations A and B have the tasks module via
// a real assign_plan call; organisation N has none. Proves: read_only reads but
// cannot write, staff and manager can write, an organisation without the tasks
// entitlement is denied (403), and cross-tenant actions are a calm null. Plus
// the full lifecycle (create, the list filters, every status transition
// including reopen and cancel, delete with an audit row), the assignee
// integrity check (a non-member and a cross-organisation user rejected, a real
// member accepted), the polymorphic-link integrity check (non-existent, cross-
// organisation and soft-deleted records rejected, a valid one of each type
// accepted), and that overdue is derived (the overdue filter and the isOverdue
// flag pick the right tasks).

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `ta-a-${run}`;
const slugB = `ta-b-${run}`;
const slugN = `ta-n-${run}`;
const emailFor = (label: string) => `${label}-${run}@tasks-actions.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
let planId: string;
let staffAId: string;
let staffBId: string;
let nonMemberId: string;
let custAId: string;
let custADeletedId: string;
let leadAId: string;
let siteAId: string;
let quoteAId: string;
let custBId: string;
let taskBId: string;

const HOUR = 60 * 60 * 1000;

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["b", slugB],
    ["n", slugN],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Tasks Actions ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  const plan = await admin
    .from("plans")
    .insert({ key: `ta-${run}`, name: "TA", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planId = plan.data.id;
  const linked = await admin
    .from("plan_modules")
    .insert({ plan_id: planId, module: "tasks" });
  if (linked.error) throw new Error(linked.error.message);
  for (const label of ["a", "b"]) {
    const assigned = await admin.rpc("assign_plan", {
      org_id: orgIds[label],
      new_plan_id: planId,
    });
    if (assigned.error) throw new Error(assigned.error.message);
  }
  // Organisation N deliberately gets no plan and no entitlements.

  const members: Array<[string, string, string]> = [
    ["readonly-a", "a", "read_only"],
    ["staff-a", "a", "staff"],
    ["manager-a", "a", "manager"],
    ["staff-b", "b", "staff"],
    ["admin-n", "n", "client_admin"],
  ];
  const userByLabel: Record<string, string> = {};
  for (const [label, orgLabel, role] of members) {
    const user = await admin.auth.admin.createUser({
      email: emailFor(label),
      password,
      email_confirm: true,
    });
    if (user.error || !user.data.user) throw new Error(user.error?.message);
    userIds.push(user.data.user.id);
    userByLabel[label] = user.data.user.id;
    const membership = await admin.from("organisation_memberships").insert({
      organisation_id: orgIds[orgLabel],
      user_id: user.data.user.id,
      role,
      status: "active",
    });
    if (membership.error) throw new Error(membership.error.message);
  }
  staffAId = userByLabel["staff-a"];
  staffBId = userByLabel["staff-b"];

  // A user who is a member of nothing, for the assignee check.
  const nonMember = await admin.auth.admin.createUser({
    email: emailFor("nonmember"),
    password,
    email_confirm: true,
  });
  if (nonMember.error || !nonMember.data.user) {
    throw new Error(nonMember.error?.message);
  }
  nonMemberId = nonMember.data.user.id;
  userIds.push(nonMemberId);

  // Related records in organisation A: one live of each type, plus a soft-
  // deleted customer. And a live customer in organisation B for cross-tenant.
  const custA = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.a, name: `Customer A ${run}` })
    .select("id")
    .single();
  if (custA.error) throw new Error(custA.error.message);
  custAId = custA.data.id;

  const custADeleted = await admin
    .from("customers")
    .insert({
      organisation_id: orgIds.a,
      name: `Deleted customer A ${run}`,
      deleted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (custADeleted.error) throw new Error(custADeleted.error.message);
  custADeletedId = custADeleted.data.id;

  const leadA = await admin
    .from("leads")
    .insert({ organisation_id: orgIds.a, name: `Lead A ${run}` })
    .select("id")
    .single();
  if (leadA.error) throw new Error(leadA.error.message);
  leadAId = leadA.data.id;

  const siteA = await admin
    .from("sites")
    .insert({ organisation_id: orgIds.a, customer_id: custAId, name: `Site A ${run}` })
    .select("id")
    .single();
  if (siteA.error) throw new Error(siteA.error.message);
  siteAId = siteA.data.id;

  const quoteA = await admin
    .from("quotes")
    .insert({
      organisation_id: orgIds.a,
      customer_id: custAId,
      quote_number: 9001,
    })
    .select("id")
    .single();
  if (quoteA.error) throw new Error(quoteA.error.message);
  quoteAId = quoteA.data.id;

  const custB = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.b, name: `Customer B ${run}` })
    .select("id")
    .single();
  if (custB.error) throw new Error(custB.error.message);
  custBId = custB.data.id;

  // A task in organisation B, for the cross-tenant by-id checks.
  const taskB = await admin
    .from("tasks")
    .insert({ organisation_id: orgIds.b, title: `Task B ${run}` })
    .select("id")
    .single();
  if (taskB.error) throw new Error(taskB.error.message);
  taskBId = taskB.data.id;
});

test.afterAll(async () => {
  const ids = Object.values(orgIds);
  await admin.from("audit_log").delete().in("organisation_id", ids);
  await admin.from("organisations").delete().in("id", ids);
  await admin.from("plans").delete().eq("id", planId);
  for (const id of userIds) {
    await admin.auth.admin.deleteUser(id);
  }
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
  const response = await page.request.post(`/api/tasks-harness/${slug}`, {
    data: { action, input },
  });
  let data: unknown = null;
  try {
    data = ((await response.json()) as { data?: unknown }).data ?? null;
  } catch {
    // non-JSON responses (404 pages) leave data null
  }
  return { status: response.status(), data };
}

async function createTask(page: Page, input: Record<string, unknown>) {
  return (await act(page, "createTask", input)).data as
    | (Record<string, unknown> & { id: string; isOverdue: boolean })
    | null;
}

async function listIds(page: Page, filter: Record<string, unknown> = {}) {
  const { data } = await act(page, "listTasks", filter);
  return ((data as { id: string }[]) ?? []).map((t) => t.id);
}

async function auditCount(action: string, targetId: string) {
  const { data } = await admin
    .from("audit_log")
    .select("id")
    .eq("action", action)
    .eq("target_id", targetId);
  return data?.length ?? 0;
}

test("read_only reads but cannot write tasks", async ({ page }) => {
  await signIn(page, "readonly-a");
  expect((await act(page, "listTasks", {})).status).toBe(200);
  expect((await act(page, "getTask", { id: taskBId })).status).toBe(200);

  const id = crypto.randomUUID();
  expect((await act(page, "createTask", { title: "RO" })).status).toBe(403);
  expect((await act(page, "updateTask", { id, title: "RO" })).status).toBe(403);
  expect((await act(page, "setTaskStatus", { id, status: "done" })).status).toBe(403);
  expect((await act(page, "deleteTask", { id })).status).toBe(403);
});

test("staff and manager can write; an org without the tasks entitlement is denied", async ({
  page,
}) => {
  await signIn(page, "manager-a");
  const byManager = await createTask(page, { title: `Manager task ${run}` });
  expect(byManager?.id).toBeTruthy();

  await signIn(page, "staff-a");
  const byStaff = await createTask(page, { title: `Staff task ${run}` });
  expect(byStaff?.id).toBeTruthy();

  await signIn(page, "admin-n");
  expect((await act(page, "listTasks", {}, slugN)).status).toBe(403);
  expect((await act(page, "createTask", { title: "N" }, slugN)).status).toBe(403);
});

test("cross-tenant actions are rejected with a calm null", async ({ page }) => {
  await signIn(page, "staff-a");
  // Task B belongs to organisation B; staff-a is scoped to A.
  expect((await act(page, "getTask", { id: taskBId })).data).toBeNull();
  expect((await act(page, "updateTask", { id: taskBId, title: "X" })).data).toBeNull();
  expect((await act(page, "setTaskStatus", { id: taskBId, status: "done" })).data).toBeNull();
  expect((await act(page, "deleteTask", { id: taskBId })).data).toBeNull();
  expect(await listIds(page)).not.toContain(taskBId);
});

test("the assignee must be an active member of the organisation", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  // A non-member and a member of another organisation are both rejected.
  expect(await createTask(page, { title: "A1", assigned_to: nonMemberId })).toBeNull();
  expect(await createTask(page, { title: "A2", assigned_to: staffBId })).toBeNull();

  // A real member of this organisation is accepted and recorded.
  const ok = await createTask(page, { title: `Assigned ${run}`, assigned_to: staffAId });
  expect(ok?.assigned_to).toBe(staffAId);

  // The same rule applies on update.
  const t = await createTask(page, { title: `To reassign ${run}` });
  expect((await act(page, "updateTask", { id: t!.id, assigned_to: nonMemberId })).data).toBeNull();
  const reassigned = (await act(page, "updateTask", { id: t!.id, assigned_to: staffAId }))
    .data as { assigned_to: string };
  expect(reassigned.assigned_to).toBe(staffAId);
});

test("the polymorphic link must point at a live record in the organisation", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  // Non-existent, cross-organisation, and soft-deleted records are rejected.
  expect(
    await createTask(page, {
      title: "L1",
      related_type: "customer",
      related_id: crypto.randomUUID(),
    })
  ).toBeNull();
  expect(
    await createTask(page, {
      title: "L2",
      related_type: "customer",
      related_id: custBId,
    })
  ).toBeNull();
  expect(
    await createTask(page, {
      title: "L3",
      related_type: "customer",
      related_id: custADeletedId,
    })
  ).toBeNull();

  // A valid record of each type is accepted.
  const valid: Array<[string, string]> = [
    ["lead", leadAId],
    ["customer", custAId],
    ["site", siteAId],
    ["quote", quoteAId],
  ];
  for (const [related_type, related_id] of valid) {
    const linked = await createTask(page, {
      title: `Linked ${related_type} ${run}`,
      related_type,
      related_id,
    });
    expect(linked?.related_type).toBe(related_type);
    expect(linked?.related_id).toBe(related_id);
  }

  // A half-set link is rejected at the schema boundary (400).
  expect(
    (await act(page, "createTask", { title: "L4", related_type: "customer" })).status
  ).toBe(400);
});

test("full lifecycle: create, list filters, every status transition, audited delete", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  const created = await createTask(page, {
    title: `Lifecycle ${run}`,
    assigned_to: staffAId,
    related_type: "customer",
    related_id: custAId,
  });
  const id = created!.id;
  expect(created!.status).toBe("open");

  // Status transitions, including reopen and cancel (no strict lifecycle).
  for (const status of ["in_progress", "done", "open", "cancelled"]) {
    const res = (await act(page, "setTaskStatus", { id, status })).data as {
      status: string;
    };
    expect(res.status).toBe(status);
  }

  // Update a field.
  const updated = (await act(page, "updateTask", { id, title: `Lifecycle edited ${run}` }))
    .data as { title: string };
  expect(updated.title).toBe(`Lifecycle edited ${run}`);

  // A second, open task to make the status filter unambiguous.
  const openTask = await createTask(page, { title: `Open one ${run}` });

  // Filter by status: cancelled includes our task, excludes the open one.
  const cancelled = await listIds(page, { status: "cancelled" });
  expect(cancelled).toContain(id);
  expect(cancelled).not.toContain(openTask!.id);

  // Filter by assignee.
  expect(await listIds(page, { assigned_to: staffAId })).toContain(id);

  // Filter by related record.
  const byRecord = await listIds(page, {
    related_type: "customer",
    related_id: custAId,
  });
  expect(byRecord).toContain(id);

  // Delete is a permanent hard delete, audited.
  const del = (await act(page, "deleteTask", { id })).data as { id: string };
  expect(del.id).toBe(id);
  expect(await auditCount("task.deleted", id)).toBe(1);
  expect((await act(page, "getTask", { id })).data).toBeNull();
});

test("overdue is derived by the filter and the isOverdue flag", async ({ page }) => {
  await signIn(page, "staff-a");

  const past = new Date(Date.now() - HOUR).toISOString();
  const future = new Date(Date.now() + HOUR).toISOString();

  const overdue = await createTask(page, { title: `Past due ${run}`, due_at: past });
  const notYet = await createTask(page, { title: `Future due ${run}`, due_at: future });
  const noDue = await createTask(page, { title: `No due ${run}` });

  // The isOverdue flag on the create response.
  expect(overdue!.isOverdue).toBe(true);
  expect(notYet!.isOverdue).toBe(false);
  expect(noDue!.isOverdue).toBe(false);

  // The overdue filter picks exactly the past-due open task.
  const overdueIds = await listIds(page, { overdue: true });
  expect(overdueIds).toContain(overdue!.id);
  expect(overdueIds).not.toContain(notYet!.id);
  expect(overdueIds).not.toContain(noDue!.id);

  // Once done, the same task is no longer overdue, by flag or filter.
  await act(page, "setTaskStatus", { id: overdue!.id, status: "done" });
  const afterDone = (await act(page, "getTask", { id: overdue!.id })).data as {
    isOverdue: boolean;
  };
  expect(afterDone.isOverdue).toBe(false);
  expect(await listIds(page, { overdue: true })).not.toContain(overdue!.id);
});
