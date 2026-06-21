// Leads create, detail and edit screen test for Pass 1D. Runs with:
// npm run test:leads-forms
//
// One entitled organisation with a staff member and a read_only member.
// Proves the full create-view-edit journey through the real forms, the
// courtesy hiding of write controls, and that direct visits to the create
// and edit routes are denied by the gate, not by a missing button.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `lf-a-${run}`;
const emailFor = (label: string) => `${label}-${run}@leads-forms.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let orgAId: string;
let planId: string;
let seededLeadId: string;
const userIds: string[] = [];

test.beforeAll(async () => {
  const orgA = await admin
    .from("organisations")
    .insert({ name: `Forms Org A ${run}`, slug: slugA })
    .select("id")
    .single();
  if (orgA.error) throw new Error(orgA.error.message);
  orgAId = orgA.data.id;

  const plan = await admin
    .from("plans")
    .insert({ key: `lf-${run}`, name: "LF", monthly_price_pence: 1000 })
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

  const seeded = await admin
    .from("leads")
    .insert({ organisation_id: orgAId, name: `Seeded ${run}` })
    .select("id")
    .single();
  if (seeded.error) throw new Error(seeded.error.message);
  seededLeadId = seeded.data.id;
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

test("staff creates, views and edits a lead through the forms", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  await page.goto(`/app/${slugA}/leads`);

  // Create, including one inline validation failure first.
  await page.getByRole("link", { name: "New lead" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/leads/new$`));
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page.getByText("Name is required")).toBeVisible();

  await page.getByLabel("Name").fill(`Form lead ${run}`);
  await page.getByLabel("Email").fill("form.lead@example.co.uk");
  await page.getByLabel("Phone").fill("07700 900999");
  await page.getByLabel("Message").fill("Came in through the form test.");
  await page.getByLabel("Source").fill("website");
  await page.getByRole("button", { name: "Create lead" }).click();

  // Lands on the detail view of the new lead.
  await expect(page).toHaveURL(
    new RegExp(`/app/${slugA}/leads/[0-9a-f-]{36}$`)
  );
  await expect(
    page.getByRole("heading", { name: `Form lead ${run}` })
  ).toBeVisible();
  await expect(page.getByText("form.lead@example.co.uk")).toBeVisible();

  // Appears in the list.
  await page.goto(`/app/${slugA}/leads`);
  await expect(page.getByText(`Form lead ${run}`)).toBeVisible();

  // Open detail from the list, then edit, including the status.
  await page.getByRole("link", { name: `Form lead ${run}` }).click();
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await expect(page.getByLabel("Name")).toHaveValue(`Form lead ${run}`);

  await page.getByLabel("Name").fill(`Form lead ${run} renamed`);
  await page.getByLabel("Status").selectOption("qualified");
  await page.getByRole("button", { name: "Save changes" }).click();

  // Back on detail with the changes shown.
  await expect(page).toHaveURL(
    new RegExp(`/app/${slugA}/leads/[0-9a-f-]{36}$`)
  );
  await expect(
    page.getByRole("heading", { name: `Form lead ${run} renamed` })
  ).toBeVisible();
  await expect(page.getByText("qualified", { exact: true })).toBeVisible();
});

test("read_only sees no write controls and is denied on direct visits", async ({
  page,
}) => {
  await signIn(page, "readonly-a");

  await page.goto(`/app/${slugA}/leads`);
  await expect(page.getByText(`Seeded ${run}`)).toBeVisible();
  await expect(page.getByRole("link", { name: "New lead" })).toHaveCount(0);

  await page.getByRole("link", { name: `Seeded ${run}` }).click();
  await expect(
    page.getByRole("heading", { name: `Seeded ${run}` })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);

  await page.goto(`/app/${slugA}/leads/new`);
  await expect(
    page.getByText("You do not have permission to do that.")
  ).toBeVisible();

  await page.goto(`/app/${slugA}/leads/${seededLeadId}/edit`);
  await expect(
    page.getByText("You do not have permission to do that.")
  ).toBeVisible();
});
