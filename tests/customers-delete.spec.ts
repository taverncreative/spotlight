// Customers delete and restore test for Pass 2E. Runs with:
// npm run test:customers-delete
//
// One entitled organisation with a staff member and a read_only member.
// Proves the confirmed soft delete through the dialog, the deleted view and
// restore, the audit rows for both (service-role re-read), the
// no-longer-available state on a deleted customer's old URL, and the
// courtesy hiding plus server-side denial for read_only.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `cd-a-${run}`;
const emailFor = (label: string) => `${label}-${run}@customers-delete.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let orgAId: string;
let planId: string;
let targetCustomerId: string;
let keptCustomerId: string;
const userIds: string[] = [];

test.beforeAll(async () => {
  const orgA = await admin
    .from("organisations")
    .insert({ name: `Delete Customers A ${run}`, slug: slugA })
    .select("id")
    .single();
  if (orgA.error) throw new Error(orgA.error.message);
  orgAId = orgA.data.id;

  const plan = await admin
    .from("plans")
    .insert({ key: `cd-${run}`, name: "CD", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planId = plan.data.id;
  const linked = await admin
    .from("plan_modules")
    .insert({ plan_id: planId, module: "customers" });
  if (linked.error) throw new Error(linked.error.message);
  const assigned = await admin.rpc("assign_plan", {
    org_id: orgAId,
    new_plan_id: planId,
  });
  if (assigned.error) throw new Error(assigned.error.message);

  for (const [label, role] of [
    ["staff-a", "staff"],
    ["readonly-a", "read_only"],
  ] as const) {
    const user = await admin.auth.admin.createUser({
      email: emailFor(label),
      password,
      email_confirm: true,
    });
    if (user.error || !user.data.user) throw new Error(user.error?.message);
    userIds.push(user.data.user.id);
    const membership = await admin.from("organisation_memberships").insert({
      organisation_id: orgAId,
      user_id: user.data.user.id,
      role,
      status: "active",
    });
    if (membership.error) throw new Error(membership.error.message);
  }

  const target = await admin
    .from("customers")
    .insert({ organisation_id: orgAId, name: `Delete customer ${run}` })
    .select("id")
    .single();
  if (target.error) throw new Error(target.error.message);
  targetCustomerId = target.data.id;

  const kept = await admin
    .from("customers")
    .insert({ organisation_id: orgAId, name: `Keep customer ${run}` })
    .select("id")
    .single();
  if (kept.error) throw new Error(kept.error.message);
  keptCustomerId = kept.data.id;
});

test.afterAll(async () => {
  await admin.from("audit_log").delete().eq("organisation_id", orgAId);
  await admin.from("organisations").delete().eq("id", orgAId);
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

test("staff deletes through the confirm step, restores, both audited", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  // Delete with confirmation.
  await page.goto(`/app/${slugA}/customers/${targetCustomerId}`);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("alertdialog").getByText("can restore it")
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete customer" }).click();

  // Back on the list; gone from active, present in deleted.
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/customers$`));
  await expect(page.getByText(`Keep customer ${run}`)).toBeVisible();
  await expect(page.getByText(`Delete customer ${run}`)).toHaveCount(0);

  await page.getByRole("link", { name: "Deleted customers" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/customers/deleted$`));
  await expect(page.getByText(`Delete customer ${run}`)).toBeVisible();

  // The old detail URL shows the calm message.
  await page.goto(`/app/${slugA}/customers/${targetCustomerId}`);
  await expect(
    page.getByText("This customer is no longer available.")
  ).toBeVisible();

  // Audit row for the soft delete (service-role re-read).
  const deletedAudit = await admin
    .from("audit_log")
    .select("id")
    .eq("organisation_id", orgAId)
    .eq("target_id", targetCustomerId)
    .eq("action", "customer.soft_deleted");
  expect(deletedAudit.data?.length).toBe(1);

  // Restore; back in the active list.
  await page.goto(`/app/${slugA}/customers/deleted`);
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("No deleted customers.")).toBeVisible();
  await page.goto(`/app/${slugA}/customers`);
  await expect(page.getByText(`Delete customer ${run}`)).toBeVisible();

  const restoredAudit = await admin
    .from("audit_log")
    .select("id")
    .eq("organisation_id", orgAId)
    .eq("target_id", targetCustomerId)
    .eq("action", "customer.restored");
  expect(restoredAudit.data?.length).toBe(1);
});

test("read_only sees neither control and the actions deny server-side", async ({
  page,
}) => {
  await signIn(page, "readonly-a");

  await page.goto(`/app/${slugA}/customers/${keptCustomerId}`);
  await expect(
    page.getByRole("heading", { name: `Keep customer ${run}` })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete", exact: true })
  ).toHaveCount(0);

  // Seed a deleted customer so the deleted view has a row to (not) restore.
  const deleted = await admin
    .from("customers")
    .insert({
      organisation_id: orgAId,
      name: `Already deleted ${run}`,
      deleted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (deleted.error) throw new Error(deleted.error.message);

  await page.goto(`/app/${slugA}/customers/deleted`);
  await expect(page.getByText(`Already deleted ${run}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore" })).toHaveCount(0);

  // Server-side enforcement, not just hidden buttons: the actions deny.
  const denyDelete = await page.request.post(
    `/api/customers-harness/${slugA}`,
    { data: { action: "softDeleteCustomer", input: { id: keptCustomerId } } }
  );
  expect(denyDelete.status()).toBe(403);
  const denyRestore = await page.request.post(
    `/api/customers-harness/${slugA}`,
    { data: { action: "restoreCustomer", input: { id: deleted.data.id } } }
  );
  expect(denyRestore.status()).toBe(403);

  // And the rows are untouched (service-role re-read).
  const kept = await admin
    .from("customers")
    .select("deleted_at")
    .eq("id", keptCustomerId)
    .single();
  expect(kept.data?.deleted_at).toBeNull();
  const stillDeleted = await admin
    .from("customers")
    .select("deleted_at")
    .eq("id", deleted.data.id)
    .single();
  expect(stillDeleted.data?.deleted_at).not.toBeNull();
});
