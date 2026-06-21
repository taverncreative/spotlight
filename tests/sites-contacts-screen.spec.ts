// Sites and contacts screen test for Pass 5C. Runs with:
// npm run test:sites-contacts-screen
//
// Drives the customer detail page through a real browser. A write-capable
// user adds, edits and deletes a contact and moves the primary badge, and
// adds, edits, soft-deletes and restores a site. A read_only user sees both
// sections but none of the add, edit, delete or set-primary controls.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `scs-a-${run}`;
const emailFor = (label: string) => `${label}-${run}@sites-contacts-screen.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let orgId: string;
let planId: string;
const userIds: string[] = [];
let writeCustomerId: string;
let readCustomerId: string;

test.beforeAll(async () => {
  const org = await admin
    .from("organisations")
    .insert({ name: `SC Screen ${run}`, slug: slugA })
    .select("id")
    .single();
  if (org.error) throw new Error(org.error.message);
  orgId = org.data.id;

  const plan = await admin
    .from("plans")
    .insert({ key: `scs-${run}`, name: "SCS", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planId = plan.data.id;
  const linked = await admin
    .from("plan_modules")
    .insert({ plan_id: planId, module: "customers" });
  if (linked.error) throw new Error(linked.error.message);
  const assigned = await admin.rpc("assign_plan", {
    org_id: orgId,
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
      organisation_id: orgId,
      user_id: user.data.user.id,
      role,
      status: "active",
    });
    if (membership.error) throw new Error(membership.error.message);
  }

  const writeCust = await admin
    .from("customers")
    .insert({ organisation_id: orgId, name: `Write Customer ${run}` })
    .select("id")
    .single();
  if (writeCust.error) throw new Error(writeCust.error.message);
  writeCustomerId = writeCust.data.id;

  const readCust = await admin
    .from("customers")
    .insert({ organisation_id: orgId, name: `Read Customer ${run}` })
    .select("id")
    .single();
  if (readCust.error) throw new Error(readCust.error.message);
  readCustomerId = readCust.data.id;
  // The read-only customer has a contact and a site to look at.
  await admin.from("contacts").insert({
    organisation_id: orgId,
    customer_id: readCustomerId,
    name: `Seen Contact ${run}`,
    is_primary: true,
  });
  await admin.from("sites").insert({
    organisation_id: orgId,
    customer_id: readCustomerId,
    name: `Seen Site ${run}`,
  });
});

test.afterAll(async () => {
  await admin.from("audit_log").delete().eq("organisation_id", orgId);
  await admin.from("organisations").delete().eq("id", orgId);
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

const detail = (customerId: string) =>
  `/app/${slugA}/customers/${customerId}`;

test("a write-capable user manages contacts and the primary badge moves", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  await page.goto(detail(writeCustomerId));
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();

  const addContact = page.locator('form[aria-label="Add contact"]');

  // Add Alice.
  await addContact.getByLabel("Name").fill(`Alice ${run}`);
  await addContact.getByLabel("Email").fill(`alice-${run}@example.com`);
  await addContact.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByText(`Alice ${run}`)).toBeVisible();

  // Add Bob.
  await addContact.getByLabel("Name").fill(`Bob ${run}`);
  await addContact.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByText(`Bob ${run}`)).toBeVisible();

  const aliceRow = page.getByRole("listitem").filter({ hasText: `Alice ${run}` });
  const bobRow = page.getByRole("listitem").filter({ hasText: `Bob ${run}` });

  // Set Bob primary: the badge is on Bob, and Alice can still be set primary.
  await bobRow.getByRole("button", { name: "Set primary" }).click();
  await expect(bobRow.getByText("Primary", { exact: true })).toBeVisible();
  await expect(aliceRow.getByText("Primary", { exact: true })).toHaveCount(0);

  // Move it: set Alice primary, and the badge moves off Bob.
  await aliceRow.getByRole("button", { name: "Set primary" }).click();
  await expect(aliceRow.getByText("Primary", { exact: true })).toBeVisible();
  await expect(bobRow.getByText("Primary", { exact: true })).toHaveCount(0);

  // Edit Bob.
  await bobRow.getByRole("link", { name: "Edit" }).click();
  const editForm = page.locator('form[aria-label="Edit contact"]');
  await editForm.getByLabel("Name").fill(`Bob Edited ${run}`);
  await editForm.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(`Bob Edited ${run}`)).toBeVisible();

  // Delete Bob (permanent, behind a confirm dialog).
  const bobEdited = page
    .getByRole("listitem")
    .filter({ hasText: `Bob Edited ${run}` });
  await bobEdited.getByRole("button", { name: "Delete" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete contact" })
    .click();
  await expect(page.getByText(`Bob Edited ${run}`)).toHaveCount(0);
  await expect(page.getByText(`Alice ${run}`)).toBeVisible();
});

test("a write-capable user adds, edits, soft-deletes and restores a site", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  await page.goto(detail(writeCustomerId));
  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();

  const addSite = page.locator('form[aria-label="Add site"]');
  await addSite.getByLabel("Name").fill(`Yard ${run}`);
  await addSite.getByLabel("Town").fill("Chatham");
  await addSite.getByRole("button", { name: "Add site" }).click();
  await expect(page.getByText(`Yard ${run}`)).toBeVisible();

  // Edit it.
  const yardRow = page.getByRole("listitem").filter({ hasText: `Yard ${run}` });
  await yardRow.getByRole("link", { name: "Edit" }).click();
  const editSite = page.locator('form[aria-label="Edit site"]');
  await editSite.getByLabel("Name").fill(`Yard Edited ${run}`);
  await editSite.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(`Yard Edited ${run}`)).toBeVisible();

  // Soft-delete: gone from the active list.
  const editedRow = page
    .getByRole("listitem")
    .filter({ hasText: `Yard Edited ${run}` });
  await editedRow.getByRole("button", { name: "Delete" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete site" })
    .click();
  await expect(page.getByText(`Yard Edited ${run}`)).toHaveCount(0);

  // Present in the deleted-sites view, where it can be restored.
  await page.getByRole("link", { name: "Deleted sites" }).click();
  await expect(page.getByText(`Yard Edited ${run}`)).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();

  // Back in the active list.
  await expect(page.getByText(`Yard Edited ${run}`)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Deleted sites" })
  ).toBeVisible();
});

test("a read_only user sees both sections but none of the controls", async ({
  page,
}) => {
  await signIn(page, "readonly-a");
  await page.goto(detail(readCustomerId));

  // Both sections and their seeded rows are visible.
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
  await expect(page.getByText(`Seen Contact ${run}`)).toBeVisible();
  await expect(page.getByText(`Seen Site ${run}`)).toBeVisible();

  // But no management controls anywhere on the page.
  await expect(page.locator('form[aria-label="Add contact"]')).toHaveCount(0);
  await expect(page.locator('form[aria-label="Add site"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Set primary" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
});
