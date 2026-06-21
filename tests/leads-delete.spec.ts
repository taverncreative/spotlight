// Leads delete and restore test for Pass 1E. Runs with: npm run test:leads-delete
//
// One entitled organisation with a staff member and a read_only member.
// Proves the confirmed soft delete through the dialog, the deleted view and
// restore, the audit rows for both (service-role re-read), the
// no-longer-available state on a deleted lead's old URL, the courtesy hiding
// plus server-side denial for read_only, and that blank optional fields
// store null rather than empty strings.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `ld-a-${run}`;
const emailFor = (label: string) => `${label}-${run}@leads-delete.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let orgAId: string;
let planId: string;
let targetLeadId: string;
let keptLeadId: string;
const userIds: string[] = [];

test.beforeAll(async () => {
  const orgA = await admin
    .from("organisations")
    .insert({ name: `Delete Org A ${run}`, slug: slugA })
    .select("id")
    .single();
  if (orgA.error) throw new Error(orgA.error.message);
  orgAId = orgA.data.id;

  const plan = await admin
    .from("plans")
    .insert({ key: `ld-${run}`, name: "LD", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planId = plan.data.id;
  const linked = await admin
    .from("plan_modules")
    .insert({ plan_id: planId, module: "leads" });
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
    .from("leads")
    .insert({ organisation_id: orgAId, name: `Delete me ${run}` })
    .select("id")
    .single();
  if (target.error) throw new Error(target.error.message);
  targetLeadId = target.data.id;

  const kept = await admin
    .from("leads")
    .insert({ organisation_id: orgAId, name: `Keep me ${run}` })
    .select("id")
    .single();
  if (kept.error) throw new Error(kept.error.message);
  keptLeadId = kept.data.id;
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
  await page.goto(`/app/${slugA}/leads/${targetLeadId}`);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("alertdialog").getByText("can restore it")
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete lead" }).click();

  // Back on the list; gone from active, present in deleted.
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/leads$`));
  await expect(page.getByText(`Keep me ${run}`)).toBeVisible();
  await expect(page.getByText(`Delete me ${run}`)).toHaveCount(0);

  await page.getByRole("link", { name: "Deleted leads" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/leads/deleted$`));
  await expect(page.getByText(`Delete me ${run}`)).toBeVisible();

  // The old detail URL shows the calm message.
  await page.goto(`/app/${slugA}/leads/${targetLeadId}`);
  await expect(
    page.getByText("This lead is no longer available.")
  ).toBeVisible();

  // Audit row for the soft delete (service-role re-read).
  const deletedAudit = await admin
    .from("audit_log")
    .select("id")
    .eq("organisation_id", orgAId)
    .eq("target_id", targetLeadId)
    .eq("action", "lead.soft_deleted");
  expect(deletedAudit.data?.length).toBe(1);

  // Restore; back in the active list.
  await page.goto(`/app/${slugA}/leads/deleted`);
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("No deleted leads.")).toBeVisible();
  await page.goto(`/app/${slugA}/leads`);
  await expect(page.getByText(`Delete me ${run}`)).toBeVisible();

  const restoredAudit = await admin
    .from("audit_log")
    .select("id")
    .eq("organisation_id", orgAId)
    .eq("target_id", targetLeadId)
    .eq("action", "lead.restored");
  expect(restoredAudit.data?.length).toBe(1);
});

test("blank optional fields store null, not empty strings", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  await page.goto(`/app/${slugA}/leads/new`);
  await page.getByLabel("Name").fill(`Null check ${run}`);
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/app/${slugA}/leads/[0-9a-f-]{36}$`)
  );

  const saved = await admin
    .from("leads")
    .select("email, phone, message, source")
    .eq("organisation_id", orgAId)
    .eq("name", `Null check ${run}`)
    .single();
  expect(saved.data?.email).toBeNull();
  expect(saved.data?.phone).toBeNull();
  expect(saved.data?.message).toBeNull();
  expect(saved.data?.source).toBeNull();
});

test("read_only sees neither control and the actions deny server-side", async ({
  page,
}) => {
  await signIn(page, "readonly-a");

  await page.goto(`/app/${slugA}/leads/${keptLeadId}`);
  await expect(
    page.getByRole("heading", { name: `Keep me ${run}` })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete", exact: true })
  ).toHaveCount(0);

  // Seed a deleted lead so the deleted view has a row to (not) restore.
  const deleted = await admin
    .from("leads")
    .insert({
      organisation_id: orgAId,
      name: `Already deleted ${run}`,
      deleted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (deleted.error) throw new Error(deleted.error.message);

  await page.goto(`/app/${slugA}/leads/deleted`);
  await expect(page.getByText(`Already deleted ${run}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore" })).toHaveCount(0);

  // Server-side enforcement, not just hidden buttons: the actions deny.
  const denyDelete = await page.request.post(`/api/leads-harness/${slugA}`, {
    data: { action: "softDeleteLead", input: { id: keptLeadId } },
  });
  expect(denyDelete.status()).toBe(403);
  const denyRestore = await page.request.post(`/api/leads-harness/${slugA}`, {
    data: { action: "restoreLead", input: { id: deleted.data.id } },
  });
  expect(denyRestore.status()).toBe(403);

  // And the rows are untouched (service-role re-read).
  const kept = await admin
    .from("leads")
    .select("deleted_at")
    .eq("id", keptLeadId)
    .single();
  expect(kept.data?.deleted_at).toBeNull();
  const stillDeleted = await admin
    .from("leads")
    .select("deleted_at")
    .eq("id", deleted.data.id)
    .single();
  expect(stillDeleted.data?.deleted_at).not.toBeNull();
});
