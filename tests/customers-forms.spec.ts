// Customers create, detail and edit screen test for Pass 2D. Runs with:
// npm run test:customers-forms
//
// One entitled organisation with a staff member and a read_only member.
// Proves the full create-view-edit journey through the real forms including
// the type change, the courtesy hiding of write controls, and that direct
// visits to the create and edit routes are denied by the gate.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `cf-a-${run}`;
const emailFor = (label: string) => `${label}-${run}@customers-forms.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let orgAId: string;
let planId: string;
let seededCustomerId: string;
const userIds: string[] = [];

test.beforeAll(async () => {
  const orgA = await admin
    .from("organisations")
    .insert({ name: `Forms Customers A ${run}`, slug: slugA })
    .select("id")
    .single();
  if (orgA.error) throw new Error(orgA.error.message);
  orgAId = orgA.data.id;

  const plan = await admin
    .from("plans")
    .insert({ key: `cf-${run}`, name: "CF", monthly_price_pence: 1000 })
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

  const seeded = await admin
    .from("customers")
    .insert({ organisation_id: orgAId, name: `Seeded customer ${run}` })
    .select("id")
    .single();
  if (seeded.error) throw new Error(seeded.error.message);
  seededCustomerId = seeded.data.id;
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

test("staff creates, views and edits a customer through the forms", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  await page.goto(`/app/${slugA}/customers`);

  // Create, including one inline validation failure first.
  await page.getByRole("link", { name: "New customer" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/customers/new$`));
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByText("Name is required")).toBeVisible();

  await page.getByLabel("Name").fill(`Form customer ${run}`);
  await page.getByLabel("Type").selectOption("individual");
  await page.getByLabel("Email").fill("form.customer@example.co.uk");
  await page.getByLabel("Phone").fill("07700 900888");
  await page.getByLabel("Address line 1").fill("1 Quay Street");
  await page.getByLabel("Town").fill("Rochester");
  await page.getByLabel("Postcode").fill("ME1 1AA");
  await page.getByRole("button", { name: "Create customer" }).click();

  // Lands on the detail view of the new customer.
  await expect(page).toHaveURL(
    new RegExp(`/app/${slugA}/customers/[0-9a-f-]{36}$`)
  );
  await expect(
    page.getByRole("heading", { name: `Form customer ${run}` })
  ).toBeVisible();
  await expect(page.getByText("individual", { exact: true })).toBeVisible();
  await expect(page.getByText("form.customer@example.co.uk")).toBeVisible();
  await expect(page.getByText("1 Quay Street")).toBeVisible();

  // Appears in the list; open detail from the list, then edit.
  await page.goto(`/app/${slugA}/customers`);
  await expect(page.getByText(`Form customer ${run}`)).toBeVisible();
  await page.getByRole("link", { name: `Form customer ${run}` }).click();
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await expect(page.getByLabel("Name")).toHaveValue(`Form customer ${run}`);
  await expect(page.getByLabel("Type")).toHaveValue("individual");

  await page.getByLabel("Name").fill(`Form customer ${run} Ltd`);
  await page.getByLabel("Type").selectOption("business");
  await page.getByLabel("Town").fill("Chatham");
  await page.getByRole("button", { name: "Save changes" }).click();

  // Back on detail with the changes shown, including the type.
  await expect(page).toHaveURL(
    new RegExp(`/app/${slugA}/customers/[0-9a-f-]{36}$`)
  );
  await expect(
    page.getByRole("heading", { name: `Form customer ${run} Ltd` })
  ).toBeVisible();
  await expect(page.getByText("business", { exact: true })).toBeVisible();
  await expect(page.getByText("Chatham")).toBeVisible();
});

test("read_only sees no write controls and is denied on direct visits", async ({
  page,
}) => {
  await signIn(page, "readonly-a");

  await page.goto(`/app/${slugA}/customers`);
  await expect(page.getByText(`Seeded customer ${run}`)).toBeVisible();
  await expect(page.getByRole("link", { name: "New customer" })).toHaveCount(0);

  await page.getByRole("link", { name: `Seeded customer ${run}` }).click();
  await expect(
    page.getByRole("heading", { name: `Seeded customer ${run}` })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);

  await page.goto(`/app/${slugA}/customers/new`);
  await expect(
    page.getByText("You do not have permission to do that.")
  ).toBeVisible();

  await page.goto(`/app/${slugA}/customers/${seededCustomerId}/edit`);
  await expect(
    page.getByText("You do not have permission to do that.")
  ).toBeVisible();
});
