// Leads server action test for Pass 1B. Runs with: npm run test:leads-actions
//
// Exercises the real server actions through the harness route with real
// signed-in sessions per role. Organisation A and B have the leads module
// via a real assign_plan call; organisation N has no entitlements at all.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `la-a-${run}`;
const slugB = `la-b-${run}`;
const slugN = `la-n-${run}`;
const emailFor = (label: string) => `${label}-${run}@leads-actions.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
let planId: string;
let leadBId: string;

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["b", slugB],
    ["n", slugN],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Leads Actions ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  const plan = await admin
    .from("plans")
    .insert({ key: `la-${run}`, name: "LA", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planId = plan.data.id;
  const linked = await admin
    .from("plan_modules")
    .insert({ plan_id: planId, module: "leads" });
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
    const membership = await admin.from("organisation_memberships").insert({
      organisation_id: orgIds[orgLabel],
      user_id: user.data.user.id,
      role,
      status: "active",
    });
    if (membership.error) throw new Error(membership.error.message);
  }

  const leadB = await admin
    .from("leads")
    .insert({ organisation_id: orgIds.b, name: "Org B lead" })
    .select("id")
    .single();
  if (leadB.error) throw new Error(leadB.error.message);
  leadBId = leadB.data.id;
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

async function act(
  page: Page,
  action: string,
  input: unknown = {},
  slug = slugA
) {
  const response = await page.request.post(`/api/leads-harness/${slug}`, {
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

test("read_only: reads allowed, every write denied", async ({ page }) => {
  await signIn(page, "readonly-a");
  expect((await act(page, "listLeads")).status).toBe(200);
  expect((await act(page, "listDeletedLeads")).status).toBe(200);
  expect((await act(page, "getLead", { id: crypto.randomUUID() })).status).toBe(
    200
  );
  expect((await act(page, "createLead", { name: "Nope" })).status).toBe(403);
  expect(
    (await act(page, "updateLead", { id: crypto.randomUUID(), name: "N" }))
      .status
  ).toBe(403);
  expect(
    (await act(page, "softDeleteLead", { id: crypto.randomUUID() })).status
  ).toBe(403);
  expect(
    (await act(page, "restoreLead", { id: crypto.randomUUID() })).status
  ).toBe(403);
});

test("staff lifecycle: create, update, soft delete, restore, audit", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  const created = await act(page, "createLead", {
    name: "Lifecycle lead",
    email: "lifecycle@example.com",
    source: "test",
  });
  expect(created.status).toBe(200);
  const lead = created.data as { id: string; name: string };
  expect(lead.name).toBe("Lifecycle lead");

  const listed = await act(page, "listLeads");
  expect(
    (listed.data as { id: string }[]).some((row) => row.id === lead.id)
  ).toBe(true);

  const updated = await act(page, "updateLead", {
    id: lead.id,
    name: "Lifecycle lead renamed",
    status: "contacted",
  });
  expect(updated.status).toBe(200);
  expect((updated.data as { name: string; status: string }).status).toBe(
    "contacted"
  );

  const deleted = await act(page, "softDeleteLead", { id: lead.id });
  expect(deleted.status).toBe(200);
  expect((deleted.data as { id: string }).id).toBe(lead.id);

  const afterDelete = await act(page, "listLeads");
  expect(
    (afterDelete.data as { id: string }[]).some((row) => row.id === lead.id)
  ).toBe(false);

  const deletedList = await act(page, "listDeletedLeads");
  expect(
    (deletedList.data as { id: string }[]).some((row) => row.id === lead.id)
  ).toBe(true);

  const restored = await act(page, "restoreLead", { id: lead.id });
  expect(restored.status).toBe(200);

  const afterRestore = await act(page, "listLeads");
  expect(
    (afterRestore.data as { id: string }[]).some((row) => row.id === lead.id)
  ).toBe(true);

  // Both lifecycle steps were audit logged, with the actor recorded.
  const audit = await admin
    .from("audit_log")
    .select("action, actor_user_id")
    .eq("organisation_id", orgIds.a)
    .eq("target_id", lead.id);
  const actions = (audit.data ?? []).map((row) => row.action).sort();
  expect(actions).toEqual(["lead.restored", "lead.soft_deleted"]);
  expect((audit.data ?? []).every((row) => row.actor_user_id !== null)).toBe(
    true
  );
});

test("organisation without the leads entitlement is denied everything", async ({
  page,
}) => {
  await signIn(page, "admin-n");
  expect((await act(page, "listLeads", {}, slugN)).status).toBe(403);
  expect((await act(page, "createLead", { name: "No" }, slugN)).status).toBe(
    403
  );
  expect(
    (await act(page, "softDeleteLead", { id: crypto.randomUUID() }, slugN))
      .status
  ).toBe(403);
});

test("member of A cannot act on B's leads", async ({ page }) => {
  await signIn(page, "staff-a");

  // Targeting organisation B's workspace directly: not a member, 404.
  expect((await act(page, "listLeads", {}, slugB)).status).toBe(404);

  // Targeting B's lead through A's workspace: scoped query finds nothing.
  const update = await act(page, "updateLead", {
    id: leadBId,
    name: "Hijacked",
  });
  expect(update.status).toBe(200);
  expect(update.data).toBeNull();
  const softDelete = await act(page, "softDeleteLead", { id: leadBId });
  expect(softDelete.data).toBeNull();

  const untouched = await admin
    .from("leads")
    .select("name, deleted_at")
    .eq("id", leadBId)
    .single();
  expect(untouched.data?.name).toBe("Org B lead");
  expect(untouched.data?.deleted_at).toBeNull();
});
