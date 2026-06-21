// Customers server action test for Pass 2B. Runs with:
// npm run test:customers-actions
//
// Mirrors the leads action test: exercises the real server actions through
// the harness route with real signed-in sessions per role. Organisations A
// and B have the customers module via a real assign_plan call; organisation
// N has no entitlements at all.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `ca-a-${run}`;
const slugB = `ca-b-${run}`;
const slugN = `ca-n-${run}`;
const emailFor = (label: string) => `${label}-${run}@customers-actions.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
let planId: string;
let customerBId: string;

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["b", slugB],
    ["n", slugN],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Customers Actions ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  const plan = await admin
    .from("plans")
    .insert({ key: `ca-${run}`, name: "CA", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planId = plan.data.id;
  const linked = await admin
    .from("plan_modules")
    .insert({ plan_id: planId, module: "customers" });
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

  const customerB = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.b, name: "Org B customer" })
    .select("id")
    .single();
  if (customerB.error) throw new Error(customerB.error.message);
  customerBId = customerB.data.id;
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
  const response = await page.request.post(`/api/customers-harness/${slug}`, {
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
  expect((await act(page, "listCustomers")).status).toBe(200);
  expect((await act(page, "listDeletedCustomers")).status).toBe(200);
  expect(
    (await act(page, "getCustomer", { id: crypto.randomUUID() })).status
  ).toBe(200);
  expect((await act(page, "createCustomer", { name: "Nope" })).status).toBe(
    403
  );
  expect(
    (await act(page, "updateCustomer", { id: crypto.randomUUID(), name: "N" }))
      .status
  ).toBe(403);
  expect(
    (await act(page, "softDeleteCustomer", { id: crypto.randomUUID() })).status
  ).toBe(403);
  expect(
    (await act(page, "restoreCustomer", { id: crypto.randomUUID() })).status
  ).toBe(403);
});

test("staff lifecycle: create, update, soft delete, restore, audit", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  const created = await act(page, "createCustomer", {
    name: "Lifecycle customer",
    type: "individual",
    email: "lifecycle@example.co.uk",
    town: "Maidstone",
  });
  expect(created.status).toBe(200);
  const customer = created.data as { id: string; name: string; type: string };
  expect(customer.name).toBe("Lifecycle customer");
  expect(customer.type).toBe("individual");

  const listed = await act(page, "listCustomers");
  expect(
    (listed.data as { id: string }[]).some((row) => row.id === customer.id)
  ).toBe(true);

  const updated = await act(page, "updateCustomer", {
    id: customer.id,
    name: "Lifecycle customer renamed",
    postcode: "ME14 1XX",
  });
  expect(updated.status).toBe(200);
  expect((updated.data as { postcode: string }).postcode).toBe("ME14 1XX");

  const deleted = await act(page, "softDeleteCustomer", { id: customer.id });
  expect(deleted.status).toBe(200);
  expect((deleted.data as { id: string }).id).toBe(customer.id);

  const afterDelete = await act(page, "listCustomers");
  expect(
    (afterDelete.data as { id: string }[]).some((row) => row.id === customer.id)
  ).toBe(false);

  const deletedList = await act(page, "listDeletedCustomers");
  expect(
    (deletedList.data as { id: string }[]).some((row) => row.id === customer.id)
  ).toBe(true);

  const restored = await act(page, "restoreCustomer", { id: customer.id });
  expect(restored.status).toBe(200);

  const afterRestore = await act(page, "listCustomers");
  expect(
    (afterRestore.data as { id: string }[]).some(
      (row) => row.id === customer.id
    )
  ).toBe(true);

  // Both lifecycle steps were audit logged, with the actor recorded.
  const audit = await admin
    .from("audit_log")
    .select("action, actor_user_id")
    .eq("organisation_id", orgIds.a)
    .eq("target_id", customer.id);
  const actions = (audit.data ?? []).map((row) => row.action).sort();
  expect(actions).toEqual(["customer.restored", "customer.soft_deleted"]);
  expect((audit.data ?? []).every((row) => row.actor_user_id !== null)).toBe(
    true
  );
});

test("organisation without the customers entitlement is denied everything", async ({
  page,
}) => {
  await signIn(page, "admin-n");
  expect((await act(page, "listCustomers", {}, slugN)).status).toBe(403);
  expect(
    (await act(page, "createCustomer", { name: "No" }, slugN)).status
  ).toBe(403);
  expect(
    (await act(page, "softDeleteCustomer", { id: crypto.randomUUID() }, slugN))
      .status
  ).toBe(403);
});

test("member of A cannot act on B's customers", async ({ page }) => {
  await signIn(page, "staff-a");

  // Targeting organisation B's workspace directly: not a member, 404.
  expect((await act(page, "listCustomers", {}, slugB)).status).toBe(404);

  // Targeting B's customer through A's workspace: scoped query finds nothing.
  const update = await act(page, "updateCustomer", {
    id: customerBId,
    name: "Hijacked",
  });
  expect(update.status).toBe(200);
  expect(update.data).toBeNull();
  const softDelete = await act(page, "softDeleteCustomer", {
    id: customerBId,
  });
  expect(softDelete.data).toBeNull();

  const untouched = await admin
    .from("customers")
    .select("name, deleted_at")
    .eq("id", customerBId)
    .single();
  expect(untouched.data?.name).toBe("Org B customer");
  expect(untouched.data?.deleted_at).toBeNull();
});
