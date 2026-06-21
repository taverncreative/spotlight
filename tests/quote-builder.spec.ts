// Quote builder test for Pass 3E. Runs with: npm run test:quote-builder
//
// A staff member creates a quote by choosing a customer, builds it up line
// by line and watches the totals, which the page always reads back from the
// database after each operation. The test asserts the displayed total
// equals the stored total_pence directly. read_only sees no controls and is
// denied on the builder route.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `qb-a-${run}`;
const emailFor = (label: string) => `${label}-${run}@quote-builder.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let orgAId: string;
let planId: string;
let custAId: string;
let seededQuoteId: string;
const userIds: string[] = [];

test.beforeAll(async () => {
  const orgA = await admin
    .from("organisations")
    .insert({ name: `Builder Org ${run}`, slug: slugA })
    .select("id")
    .single();
  if (orgA.error) throw new Error(orgA.error.message);
  orgAId = orgA.data.id;

  const plan = await admin
    .from("plans")
    .insert({ key: `qb-${run}`, name: "QB", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planId = plan.data.id;
  const linked = await admin
    .from("plan_modules")
    .insert({ plan_id: planId, module: "quotes" });
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

  const customer = await admin
    .from("customers")
    .insert({ organisation_id: orgAId, name: `Builder Co ${run}` })
    .select("id")
    .single();
  if (customer.error) throw new Error(customer.error.message);
  custAId = customer.data.id;

  const seeded = await admin
    .from("quotes")
    .insert({
      organisation_id: orgAId,
      customer_id: custAId,
      quote_number: 50,
      title: `Seeded quote ${run}`,
    })
    .select("id")
    .single();
  if (seeded.error) throw new Error(seeded.error.message);
  seededQuoteId = seeded.data.id;
});

test.afterAll(async () => {
  await admin.from("audit_log").delete().eq("organisation_id", orgAId);
  await admin.from("quotes").delete().eq("organisation_id", orgAId);
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

test("staff builds a quote and the totals always match the database", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  // Create the draft from the list.
  await page.goto(`/app/${slugA}/quotes`);
  await page.getByRole("link", { name: "New quote" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/quotes/new$`));
  await page.getByLabel("Customer").selectOption({
    label: `Builder Co ${run}`,
  });
  await page.getByLabel("Title").fill(`Built quote ${run}`);
  await page.getByRole("button", { name: "Create quote" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/app/${slugA}/quotes/[0-9a-f-]{36}/edit$`)
  );
  await expect(page.getByTestId("quote-total")).toHaveText("£0.00");

  // Line 1: 2 x £199.99 at 20% -> net £399.98, VAT £80.00, total £479.98.
  const addForm = page.locator('form[aria-label="Add line item"]');
  await addForm.getByLabel("Description").fill(`Crane hire ${run}`);
  await addForm.getByLabel("Quantity").fill("2");
  await addForm.getByLabel("Unit price (£)").fill("199.99");
  await addForm.getByLabel("VAT rate (%)").fill("20");
  await addForm.getByRole("button", { name: "Save line" }).click();
  await expect(page.getByTestId("quote-total")).toHaveText("£479.98");

  // The saved line appears as a read-only display row (no edit form), the
  // visible confirmation it saved, and the add form is empty again.
  const display1 = page.getByTestId("line-display-1");
  await expect(display1).toBeVisible();
  await expect(display1.getByText(`Crane hire ${run}`)).toBeVisible();
  await expect(display1.getByText("2.00 × £199.99")).toBeVisible();
  await expect(display1.getByText("£399.98")).toBeVisible();
  await expect(page.locator('form[aria-label="Line 1"]')).toHaveCount(0);
  await expect(addForm.getByLabel("Description")).toHaveValue("");

  // Line 2: 1 x £50.00 at 0% -> total £529.98.
  await addForm.getByLabel("Description").fill(`Documentation ${run}`);
  await addForm.getByLabel("Quantity").fill("1");
  await addForm.getByLabel("Unit price (£)").fill("50.00");
  await addForm.getByLabel("VAT rate (%)").fill("0");
  await addForm.getByRole("button", { name: "Save line" }).click();
  await expect(page.getByTestId("quote-total")).toHaveText("£529.98");

  // The displayed total equals the stored total, penny for penny.
  const stored = await admin
    .from("quotes")
    .select("total_pence")
    .eq("organisation_id", orgAId)
    .eq("title", `Built quote ${run}`)
    .single();
  expect(stored.data?.total_pence).toBe(52998);
  const displayed = await page.getByTestId("quote-total").textContent();
  expect(displayed).toBe(
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format(stored.data!.total_pence / 100)
  );

  // Edit line 1 via its explicit Edit control: only that row becomes a
  // form, line 2 stays a display row. 3 x £199.99 -> with line 2 the total
  // becomes £769.96, and the row returns to display mode showing 3.00.
  await page
    .getByTestId("line-display-1")
    .getByRole("link", { name: "Edit" })
    .click();
  await expect(page).toHaveURL(/editLine=/);
  const line1 = page.locator('form[aria-label="Line 1"]');
  await expect(line1.getByLabel("Quantity")).toHaveValue("2.00");
  await expect(page.locator('form[aria-label="Line 2"]')).toHaveCount(0);
  await expect(page.getByTestId("line-display-2")).toBeVisible();
  await line1.getByLabel("Quantity").fill("3");
  await line1.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("quote-total")).toHaveText("£769.96");
  await expect(page).not.toHaveURL(/editLine=/);
  await expect(page.locator('form[aria-label="Line 1"]')).toHaveCount(0);
  await expect(
    page.getByTestId("line-display-1").getByText("3.00 × £199.99")
  ).toBeVisible();

  // Cancel an edit: change a field, cancel, nothing changed.
  await page
    .getByTestId("line-display-1")
    .getByRole("link", { name: "Edit" })
    .click();
  await line1.getByLabel("Quantity").fill("9");
  await line1.getByRole("link", { name: "Cancel" }).click();
  await expect(page).not.toHaveURL(/editLine=/);
  await expect(page.getByTestId("quote-total")).toHaveText("£769.96");
  await expect(
    page.getByTestId("line-display-1").getByText("3.00 × £199.99")
  ).toBeVisible();

  // Remove line 2 from its display row: back to line 1 alone, £719.96.
  await page
    .getByTestId("line-display-2")
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.getByTestId("quote-total")).toHaveText("£719.96");
  await expect(page.getByTestId("line-display-2")).toHaveCount(0);

  // Edit the header and see it stick.
  await page.getByLabel("Title").fill(`Built quote ${run} v2`);
  await page.getByRole("button", { name: "Save header" }).click();
  await expect(page.getByLabel("Title")).toHaveValue(`Built quote ${run} v2`);

  // The read-only detail agrees with the builder; Done returns to it.
  await page.getByRole("link", { name: "Done" }).click();
  await expect(
    page.getByRole("heading", { name: `Quote #1 Built quote ${run} v2` })
  ).toBeVisible();
  await expect(page.getByText("£719.96")).toBeVisible();
});

test("read_only sees no controls and is denied on the builder", async ({
  page,
}) => {
  await signIn(page, "readonly-a");

  await page.goto(`/app/${slugA}/quotes`);
  await expect(page.getByText(`#50 Seeded quote ${run}`)).toBeVisible();
  await expect(page.getByRole("link", { name: "New quote" })).toHaveCount(0);

  await page.goto(`/app/${slugA}/quotes/${seededQuoteId}`);
  await expect(
    page.getByRole("heading", { name: `Quote #50 Seeded quote ${run}` })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);

  await page.goto(`/app/${slugA}/quotes/${seededQuoteId}/edit`);
  await expect(
    page.getByText("You do not have permission to do that.")
  ).toBeVisible();
});
