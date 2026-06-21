// Automations engine test for Pass 10B. Runs with: npm run test:automations-engine
//
// Proves the engine fires the lead_followup_task automation when a lead is
// created, exactly once, by both creation paths. Organisation A has the
// automation enabled and configured (title, 3 days, an assignee); B has it
// enabled but with an assignee who is not a member of B; D has it disabled; N
// has an enabled row but not the automations module. It shows: creating a lead
// via createLead creates the configured task (correct title, due date and
// assignee) linked to the lead and writes one automation_runs row; the same via
// the public webhook; firing the same lead's event again is a no-op (still one
// task); a disabled automation and an organisation without the module both fire
// nothing; tenant isolation (one workspace's automation never fires against
// another's lead, and a non-member assignee is dropped to unassigned); and the
// run is readable by a member of the workspace.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const emailFor = (label: string) => `${label}-${run}@auto-engine.test`;
const TYPE = "lead_followup_task";
const DAY = 24 * 60 * 60 * 1000;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const slugs: Record<string, string> = {};
const userIds: string[] = [];
const planIds: string[] = [];
const formTokens: Record<string, string> = {};
let writerAId: string;

async function makePlan(label: string, modules: string[]) {
  const plan = await admin
    .from("plans")
    .insert({ key: `ae-${label}-${run}`, name: "AE", monthly_price_pence: 1000 })
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

async function makeUser(label: string, orgLabel: string, role: string) {
  const user = await admin.auth.admin.createUser({
    email: emailFor(label),
    password,
    email_confirm: true,
  });
  if (user.error || !user.data.user) throw new Error(user.error?.message);
  userIds.push(user.data.user.id);
  const membership = await admin.from("organisation_memberships").insert({
    organisation_id: orgIds[orgLabel],
    user_id: user.data.user.id,
    role,
    status: "active",
  });
  if (membership.error) throw new Error(membership.error.message);
  return user.data.user.id;
}

async function setAutomation(
  orgLabel: string,
  enabled: boolean,
  config: Record<string, unknown>
) {
  const res = await admin.from("org_automations").insert({
    organisation_id: orgIds[orgLabel],
    automation_type: TYPE,
    enabled,
    config,
  });
  if (res.error) throw new Error(res.error.message);
}

async function makeForm(orgLabel: string) {
  const res = await admin
    .from("webhook_forms")
    .insert({ organisation_id: orgIds[orgLabel], name: `Form ${orgLabel} ${run}` })
    .select("token")
    .single();
  if (res.error) throw new Error(res.error.message);
  formTokens[orgLabel] = res.data.token as string;
}

test.beforeAll(async () => {
  for (const label of ["a", "b", "d", "n"]) {
    const slug = `ae-${label}-${run}`;
    slugs[label] = slug;
    const org = await admin
      .from("organisations")
      .insert({ name: `Auto Engine ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  await makePlan("a", ["leads", "automations"]);
  await makePlan("b", ["leads", "automations"]);
  await makePlan("d", ["leads", "automations"]);
  await makePlan("n", ["leads"]); // no automations module

  writerAId = await makeUser("writer-a", "a", "staff");
  await makeUser("reader-a", "a", "read_only");

  // A: enabled and configured with a real member as the assignee.
  await setAutomation("a", true, {
    task_title: "Call the new lead",
    days_until_due: 3,
    assignee_id: writerAId,
  });
  // B: enabled, but the assignee is writer-a, who is not a member of B, so the
  // engine must drop it to unassigned.
  await setAutomation("b", true, {
    task_title: "B follow up",
    days_until_due: 5,
    assignee_id: writerAId,
  });
  // D: present but disabled.
  await setAutomation("d", false, {
    task_title: "Should not fire",
    days_until_due: 1,
  });
  // N: enabled row, but the organisation lacks the automations module.
  await setAutomation("n", true, {
    task_title: "No module",
    days_until_due: 1,
  });

  for (const label of ["a", "b", "d", "n"]) await makeForm(label);
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

async function createLead(page: Page, slug: string, name: string) {
  const response = await page.request.post(`/api/leads-harness/${slug}`, {
    data: { action: "createLead", input: { name } },
  });
  const body = (await response.json()) as { data?: { id: string } };
  return body.data?.id ?? null;
}

type TaskRow = {
  id: string;
  title: string;
  due_at: string | null;
  assigned_to: string | null;
  created_by: string | null;
  status: string;
  related_type: string | null;
  related_id: string | null;
};

async function tasksForLead(orgLabel: string, leadId: string) {
  const { data } = await admin
    .from("tasks")
    .select("id, title, due_at, assigned_to, created_by, status, related_type, related_id")
    .eq("organisation_id", orgIds[orgLabel])
    .eq("related_type", "lead")
    .eq("related_id", leadId);
  return (data as TaskRow[]) ?? [];
}

async function runsForLead(orgLabel: string, leadId: string) {
  const { data } = await admin
    .from("automation_runs")
    .select("id, automation_type")
    .eq("organisation_id", orgIds[orgLabel])
    .eq("automation_type", TYPE)
    .eq("related_type", "lead")
    .eq("related_id", leadId);
  return data ?? [];
}

// Find the lead a webhook post created, by its unique name.
async function leadByName(orgLabel: string, name: string) {
  const { data } = await admin
    .from("leads")
    .select("id")
    .eq("organisation_id", orgIds[orgLabel])
    .eq("name", name)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

let leadAId: string;

test("createLead fires the configured follow-up task exactly once", async ({ page }) => {
  await signIn(page, "writer-a");
  const name = `Manual lead ${run}`;
  leadAId = (await createLead(page, slugs.a, name))!;
  expect(leadAId).toBeTruthy();

  const tasks = await tasksForLead("a", leadAId);
  expect(tasks).toHaveLength(1);
  const task = tasks[0];
  expect(task.title).toBe("Call the new lead");
  expect(task.status).toBe("open");
  expect(task.assigned_to).toBe(writerAId);
  // Created as a system action, not by the lead creator.
  expect(task.created_by).toBeNull();
  // Due roughly now plus the configured 3 days.
  const due = new Date(task.due_at!).getTime();
  expect(Math.abs(due - (Date.now() + 3 * DAY))).toBeLessThan(60 * 60 * 1000);

  // Exactly one run recorded.
  expect(await runsForLead("a", leadAId)).toHaveLength(1);
});

test("firing the same lead's event again is a no-op (still one task)", async () => {
  // A second event for the same lead: the claim-and-create function returns null
  // and creates nothing, because the run is already recorded (unique key).
  const second = await admin.rpc("run_automation_create_task", {
    p_org_id: orgIds.a,
    p_automation_type: TYPE,
    p_related_type: "lead",
    p_related_id: leadAId,
    p_task_title: "Call the new lead",
    p_days_until_due: 3,
    p_assignee_id: writerAId,
  });
  expect(second.error).toBeNull();
  expect(second.data).toBeNull();

  expect(await tasksForLead("a", leadAId)).toHaveLength(1);
  expect(await runsForLead("a", leadAId)).toHaveLength(1);
});

test("the webhook path fires the automation too", async ({ page }) => {
  const name = `Webhook lead ${run}`;
  const response = await page.request.post(`/api/lead-webhooks/${formTokens.a}`, {
    data: { name },
  });
  expect(response.status()).toBe(200);

  const leadId = await leadByName("a", name);
  expect(leadId).toBeTruthy();
  const tasks = await tasksForLead("a", leadId!);
  expect(tasks).toHaveLength(1);
  expect(tasks[0].title).toBe("Call the new lead");
  expect(await runsForLead("a", leadId!)).toHaveLength(1);
});

test("a disabled automation fires nothing", async ({ page }) => {
  const name = `Disabled lead ${run}`;
  const response = await page.request.post(`/api/lead-webhooks/${formTokens.d}`, {
    data: { name },
  });
  expect(response.status()).toBe(200);
  const leadId = await leadByName("d", name);
  expect(leadId).toBeTruthy();
  expect(await tasksForLead("d", leadId!)).toHaveLength(0);
  expect(await runsForLead("d", leadId!)).toHaveLength(0);
});

test("an organisation without the automations module fires nothing", async ({ page }) => {
  const name = `No module lead ${run}`;
  const response = await page.request.post(`/api/lead-webhooks/${formTokens.n}`, {
    data: { name },
  });
  expect(response.status()).toBe(200);
  const leadId = await leadByName("n", name);
  expect(leadId).toBeTruthy();
  expect(await tasksForLead("n", leadId!)).toHaveLength(0);
  expect(await runsForLead("n", leadId!)).toHaveLength(0);
});

test("tenant isolation and a non-member assignee dropped to unassigned", async ({
  page,
}) => {
  const name = `B lead ${run}`;
  const response = await page.request.post(`/api/lead-webhooks/${formTokens.b}`, {
    data: { name },
  });
  expect(response.status()).toBe(200);
  const leadBId = await leadByName("b", name);
  expect(leadBId).toBeTruthy();

  // B's automation fired against B's lead, creating a task in B. Its assignee
  // (writer-a) is not a member of B, so the task is unassigned.
  const bTasks = await tasksForLead("b", leadBId!);
  expect(bTasks).toHaveLength(1);
  expect(bTasks[0].title).toBe("B follow up");
  expect(bTasks[0].assigned_to).toBeNull();
  expect(await runsForLead("b", leadBId!)).toHaveLength(1);

  // No crossover: A's automation never fired against B's lead, and B's never
  // against A's lead.
  expect(await tasksForLead("a", leadBId!)).toHaveLength(0);
  expect(await runsForLead("a", leadBId!)).toHaveLength(0);
  expect(await tasksForLead("b", leadAId)).toHaveLength(0);
  expect(await runsForLead("b", leadAId)).toHaveLength(0);
});

test("the run is recorded and readable by a member of the workspace", async () => {
  // A read_only member, through their own user session, can read the workspace's
  // automation_runs (members read; the engine writes them under the service role).
  const reader = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await reader.auth.signInWithPassword({
    email: emailFor("reader-a"),
    password,
  });
  expect(signedIn.error).toBeNull();

  const { data, error } = await reader
    .from("automation_runs")
    .select("id, automation_type, related_id")
    .eq("organisation_id", orgIds.a)
    .eq("related_id", leadAId);
  expect(error).toBeNull();
  expect((data ?? []).length).toBe(1);
});
