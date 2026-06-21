// Per-record tasks section test for Pass 6D. Runs with:
// npm run test:tasks-section
//
// Drives the tasks section that now sits on the customer and quote detail
// pages. A write user sees the section, adds a task from it (which is linked to
// that record, not free-chosen), and that task shows both in the section and on
// the main Tasks list with a linked badge that points back to the record;
// edit, the quick status control and delete all work from the section. A
// read_only user sees the section and its tasks but none of the controls.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `tsec-${run}`;
const emailFor = (label: string) => `${label}-${run}@tasks-section.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let orgId: string;
let customerId: string;
let quoteId: string;
const customerName = `Acme Rigging ${run}`;
const quoteNumber = 1;
const seededTaskTitle = `Seeded customer task ${run}`;
const userIds: string[] = [];
let planId: string;

test.beforeAll(async () => {
  const org = await admin
    .from("organisations")
    .insert({ name: `Tasks Section ${run}`, slug: slugA })
    .select("id")
    .single();
  if (org.error) throw new Error(org.error.message);
  orgId = org.data.id;

  // The detail pages live under the customers and quotes modules; tasks must be
  // enabled for the section to render.
  const plan = await admin
    .from("plans")
    .insert({ key: `tsec-${run}`, name: "TSEC", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planId = plan.data.id;
  for (const moduleKey of ["tasks", "customers", "quotes"]) {
    const linked = await admin
      .from("plan_modules")
      .insert({ plan_id: planId, module: moduleKey });
    if (linked.error) throw new Error(linked.error.message);
  }
  const assigned = await admin.rpc("assign_plan", {
    org_id: orgId,
    new_plan_id: planId,
  });
  if (assigned.error) throw new Error(assigned.error.message);

  for (const [label, role] of [
    ["write", "staff"],
    ["read", "read_only"],
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

  const customer = await admin
    .from("customers")
    .insert({ organisation_id: orgId, name: customerName, type: "business" })
    .select("id")
    .single();
  if (customer.error) throw new Error(customer.error.message);
  customerId = customer.data.id;

  const quote = await admin
    .from("quotes")
    .insert({
      organisation_id: orgId,
      customer_id: customerId,
      quote_number: quoteNumber,
      title: "Section quote",
      status: "draft",
    })
    .select("id")
    .single();
  if (quote.error) throw new Error(quote.error.message);
  quoteId = quote.data.id;

  // One task already linked to the customer, so the read_only view has content.
  const seeded = await admin.from("tasks").insert({
    organisation_id: orgId,
    title: seededTaskTitle,
    status: "open",
    related_type: "customer",
    related_id: customerId,
  });
  if (seeded.error) throw new Error(seeded.error.message);
});

test.afterAll(async () => {
  // Quotes restrict customer deletion, so clear them before the org cascade.
  await admin.from("audit_log").delete().eq("organisation_id", orgId);
  await admin.from("quotes").delete().eq("organisation_id", orgId);
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
  await expect(page).toHaveURL(/\/app(\/|$)/);
}

test("customer detail shows its tasks section; a task added there is linked to the customer, shows on the main list linking back, and edit, status and delete work", async ({
  page,
}) => {
  await signIn(page, "write");
  const detail = `/app/${slugA}/customers/${customerId}`;
  await page.goto(detail);

  // The section is present.
  await expect(
    page.getByRole("heading", { name: "Tasks", level: 2 })
  ).toBeVisible();

  // Add a task from the section's add form.
  const title = `Linked customer ${run}`;
  const addForm = page.getByRole("form", { name: "Add task" });
  await addForm.getByLabel("Title").fill(title);
  await addForm.getByRole("button", { name: "Add task" }).click();

  // It redirects back to the customer and the task shows in the section.
  await expect(page).toHaveURL(new RegExp(`/customers/${customerId}$`));
  await expect(page.getByText(title)).toBeVisible();

  // On the main Tasks list it shows as linked to the customer, with a link back.
  await page.goto(`/app/${slugA}/tasks`);
  const row = page.locator("tr", { hasText: title });
  await expect(row.getByText("Customer", { exact: true })).toBeVisible();
  await expect(row.getByRole("link", { name: customerName })).toHaveAttribute(
    "href",
    detail
  );

  // Edit the task from the section.
  await page.goto(detail);
  const card = page.locator("li", { hasText: title });
  await card.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(/editTask=/);
  const edited = `Edited customer ${run}`;
  const editForm = page.getByRole("form", { name: "Edit task" });
  await editForm.getByLabel("Title").fill(edited);
  await editForm.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${customerId}$`));
  await expect(page.getByText(edited)).toBeVisible();

  // Quick status control: mark it done, the badge follows.
  const editedCard = page.locator("li", { hasText: edited });
  await editedCard.getByRole("button", { name: "Done" }).click();
  await expect(editedCard.getByText("Done", { exact: true })).toBeVisible();

  // Delete behind the permanent-delete confirm.
  await editedCard.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete task" }).click();
  await expect(page.getByText(edited)).toHaveCount(0);
});

test("quote detail shows its tasks section; a task added there is linked to the quote and shows on the main list linking back", async ({
  page,
}) => {
  await signIn(page, "write");
  const detail = `/app/${slugA}/quotes/${quoteId}`;
  await page.goto(detail);
  await expect(
    page.getByRole("heading", { name: "Tasks", level: 2 })
  ).toBeVisible();

  const title = `Linked quote ${run}`;
  const addForm = page.getByRole("form", { name: "Add task" });
  await addForm.getByLabel("Title").fill(title);
  await addForm.getByRole("button", { name: "Add task" }).click();
  await expect(page).toHaveURL(new RegExp(`/quotes/${quoteId}$`));
  await expect(page.getByText(title)).toBeVisible();

  await page.goto(`/app/${slugA}/tasks`);
  const row = page.locator("tr", { hasText: title });
  await expect(row.getByText("Quote", { exact: true })).toBeVisible();
  await expect(
    row.getByRole("link", { name: `Quote #${quoteNumber}` })
  ).toHaveAttribute("href", detail);
});

test("a read_only user sees the section and its tasks but none of the controls", async ({
  page,
}) => {
  await signIn(page, "read");
  await page.goto(`/app/${slugA}/customers/${customerId}`);

  // The section and the seeded task are visible.
  await expect(
    page.getByRole("heading", { name: "Tasks", level: 2 })
  ).toBeVisible();
  await expect(page.getByText(seededTaskTitle)).toBeVisible();

  // None of the write controls.
  await expect(page.getByRole("form", { name: "Add task" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add task" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Done" })).toHaveCount(0);
});
