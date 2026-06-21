// Automations config test for Pass 10A. Runs with: npm run test:automations
//
// Exercises the real automations actions through the harness route with real
// signed-in sessions per role. Organisation A and B have the automations module;
// organisation N does not. It proves tenant isolation, the automations-module
// gate (an organisation without it denied), that only client_admin may enable or
// configure (staff, manager and read_only denied, but all members may read the
// catalogue), that listAutomations returns the catalogue merged with this
// workspace's state, that enabling and configuring lead_followup_task persists,
// that the config validation rejects a bad day count and a non-member assignee,
// and that cross-tenant access is rejected.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `auto-a-${run}`;
const slugB = `auto-b-${run}`;
const slugN = `auto-n-${run}`;
const emailFor = (label: string) => `${label}-${run}@automations.test`;
const TYPE = "lead_followup_task";

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
const planIds: string[] = [];
const userIdByLabel: Record<string, string> = {};

async function makePlan(label: string, modules: string[]) {
  const plan = await admin
    .from("plans")
    .insert({ key: `auto-${label}-${run}`, name: "AUTO", monthly_price_pence: 1000 })
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

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["b", slugB],
    ["n", slugN],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Automations ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  // A and B have automations; N does not (customers only), so N's admin is denied.
  await makePlan("a", ["automations"]);
  await makePlan("b", ["automations"]);
  await makePlan("n", ["customers"]);

  const members: Array<[string, string, string]> = [
    ["admin-a", "a", "client_admin"],
    ["manager-a", "a", "manager"],
    ["staff-a", "a", "staff"],
    ["readonly-a", "a", "read_only"],
    ["admin-b", "b", "client_admin"],
    ["admin-n", "n", "client_admin"],
  ];
  for (const [label, orgLabel, role] of members) {
    const user = await admin.auth.admin.createUser({
      email: emailFor(label),
      password,
      email_confirm: true,
    });
    if (user.error || !user.data.user) throw new Error(user.error?.message);
    userIds.push(user.data.user.id);
    userIdByLabel[label] = user.data.user.id;
    const membership = await admin.from("organisation_memberships").insert({
      organisation_id: orgIds[orgLabel],
      user_id: user.data.user.id,
      role,
      status: "active",
    });
    if (membership.error) throw new Error(membership.error.message);
  }
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

type ActResult = { status: number; data: unknown };

async function act(
  page: Page,
  action: string,
  input: unknown = {},
  slug = slugA
): Promise<ActResult> {
  const response = await page.request.post(`/api/automations-harness/${slug}`, {
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

type CatalogueItem = {
  key: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  runnable: boolean;
  action_kind: string;
  trigger: { kind: string; description: string };
  options: { key: string }[];
};

async function listAutomations(page: Page, slug = slugA) {
  const { data } = await act(page, "listAutomations", {}, slug);
  return (data as CatalogueItem[]) ?? [];
}

async function findType(page: Page, slug = slugA) {
  const list = await listAutomations(page, slug);
  return list.find((item) => item.key === TYPE);
}

async function auditCount(action: string, targetId: string) {
  const { data } = await admin
    .from("audit_log")
    .select("id")
    .eq("action", action)
    .eq("target_id", targetId);
  return data?.length ?? 0;
}

test("an organisation without the automations module is denied", async ({ page }) => {
  await signIn(page, "admin-n");
  expect((await act(page, "listAutomations", {}, slugN)).status).toBe(403);
  expect(
    (await act(page, "setAutomationEnabled", { automation_type: TYPE, enabled: true }, slugN))
      .status
  ).toBe(403);
});

test("listAutomations returns the catalogue merged with this workspace's state", async ({
  page,
}) => {
  await signIn(page, "admin-a");
  const item = await findType(page);
  expect(item).toBeTruthy();
  expect(item!.name).toBe("Lead follow-up task");
  expect(item!.action_kind).toBe("create_task");
  expect(item!.runnable).toBe(true);
  expect(item!.trigger.kind).toBe("event");
  expect(item!.options.map((o) => o.key)).toEqual([
    "task_title",
    "days_until_due",
    "assignee_id",
  ]);
  // No row yet, so it reads as disabled with an empty config.
  expect(item!.enabled).toBe(false);
  expect(item!.config).toEqual({});
});

test("only client_admin can enable or configure; other roles can still read", async ({
  page,
}) => {
  for (const label of ["readonly-a", "staff-a", "manager-a"]) {
    await signIn(page, label);
    // Reads are allowed.
    expect((await act(page, "listAutomations")).status).toBe(200);
    // Writes are denied.
    expect(
      (await act(page, "setAutomationEnabled", { automation_type: TYPE, enabled: true })).status
    ).toBe(403);
    expect(
      (await act(page, "updateAutomationConfig", {
        automation_type: TYPE,
        config: { task_title: "x", days_until_due: 1 },
      })).status
    ).toBe(403);
  }
});

test("a client_admin enables and configures, and the config validation rejects bad input", async ({
  page,
}) => {
  await signIn(page, "admin-a");

  // Enable persists and is audited.
  const enabled = (await act(page, "setAutomationEnabled", {
    automation_type: TYPE,
    enabled: true,
  })).data as { id: string; enabled: boolean };
  expect(enabled.enabled).toBe(true);
  // At least one (a retry re-enables against the same stable row id).
  expect(await auditCount("automation.enabled", enabled.id)).toBeGreaterThanOrEqual(1);
  expect((await findType(page))!.enabled).toBe(true);

  // A valid config with an in-organisation assignee persists and is audited.
  const ok = (await act(page, "updateAutomationConfig", {
    automation_type: TYPE,
    config: {
      task_title: "Call the new lead",
      days_until_due: 2,
      assignee_id: userIdByLabel["staff-a"],
    },
  })).data as { id: string; config: Record<string, unknown> };
  expect(ok.config.task_title).toBe("Call the new lead");
  expect(ok.config.days_until_due).toBe(2);
  expect(ok.config.assignee_id).toBe(userIdByLabel["staff-a"]);
  expect(await auditCount("automation.configured", ok.id)).toBeGreaterThanOrEqual(1);

  // A bad day count (over the max, and a negative) is rejected at the schema (400).
  expect(
    (await act(page, "updateAutomationConfig", {
      automation_type: TYPE,
      config: { task_title: "x", days_until_due: 999 },
    })).status
  ).toBe(400);
  expect(
    (await act(page, "updateAutomationConfig", {
      automation_type: TYPE,
      config: { task_title: "x", days_until_due: -1 },
    })).status
  ).toBe(400);

  // An assignee who is not a member of this organisation is rejected (calm null).
  expect(
    (await act(page, "updateAutomationConfig", {
      automation_type: TYPE,
      config: {
        task_title: "x",
        days_until_due: 1,
        assignee_id: userIdByLabel["admin-b"],
      },
    })).data
  ).toBeNull();

  // An unknown automation key is rejected at the schema (400).
  expect(
    (await act(page, "setAutomationEnabled", { automation_type: "not_real", enabled: true }))
      .status
  ).toBe(400);

  // The rejected updates did not change the stored, valid config.
  const after = await findType(page);
  expect(after!.config.task_title).toBe("Call the new lead");
  expect(after!.config.days_until_due).toBe(2);
});

test("cross-tenant automation access is rejected and workspace state is isolated", async ({
  page,
}) => {
  // admin-a is not a member of organisation B, so acting there is a 404.
  await signIn(page, "admin-a");
  expect(
    (await act(page, "setAutomationEnabled", { automation_type: TYPE, enabled: true }, slugB))
      .status
  ).toBe(404);
  expect((await act(page, "listAutomations", {}, slugB)).status).toBe(404);

  // Organisation B's state is its own: A enabled lead_followup_task earlier, but
  // B sees it disabled with no config.
  await signIn(page, "admin-b");
  const itemB = await findType(page, slugB);
  expect(itemB!.enabled).toBe(false);
  expect(itemB!.config).toEqual({});
});
