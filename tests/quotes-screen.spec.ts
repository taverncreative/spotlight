// Quotes list and detail screen test for Pass 3D. Runs with:
// npm run test:quotes-screen
//
// Organisation A has the quotes module via a real assign_plan call with two
// seeded quotes (one sent with thousands-formatted money, one draft);
// organisation N has no entitlements. Proves the sidebar entry, the list
// with customer, status and formatted totals, the status filter, the detail
// view with lines and totals, read_only visibility, and that an unentitled
// organisation neither sees the nav item nor reaches the pages.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `qs-a-${run}`;
const slugN = `qs-n-${run}`;
const emailFor = (label: string) => `${label}-${run}@quotes-screen.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let orgAId: string;
let orgNId: string;
let planId: string;
let sentQuoteId: string;
const userIds: string[] = [];

test.beforeAll(async () => {
  const orgA = await admin
    .from("organisations")
    .insert({ name: `Screen Quotes A ${run}`, slug: slugA })
    .select("id")
    .single();
  const orgN = await admin
    .from("organisations")
    .insert({ name: `Screen Quotes N ${run}`, slug: slugN })
    .select("id")
    .single();
  if (orgA.error || orgN.error) {
    throw new Error(orgA.error?.message ?? orgN.error?.message);
  }
  orgAId = orgA.data.id;
  orgNId = orgN.data.id;

  const plan = await admin
    .from("plans")
    .insert({ key: `qs-${run}`, name: "QS", monthly_price_pence: 1000 })
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

  const members: Array<[string, string, string]> = [
    ["staff-a", orgAId, "staff"],
    ["readonly-a", orgAId, "read_only"],
    ["staff-n", orgNId, "staff"],
  ];
  for (const [label, orgId, role] of members) {
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
    .insert({ organisation_id: orgAId, name: `Big Crane Co ${run}` })
    .select("id")
    .single();
  if (customer.error) throw new Error(customer.error.message);

  // Sent quote: 159970 at 20% plus 5000 at 0% -> subtotal £1,649.70,
  // VAT £319.94, total £1,969.64, exercising thousands separators.
  const sent = await admin
    .from("quotes")
    .insert({
      organisation_id: orgAId,
      customer_id: customer.data.id,
      quote_number: 1,
      title: `Crane overhaul ${run}`,
      status: "sent",
    })
    .select("id")
    .single();
  if (sent.error) throw new Error(sent.error.message);
  sentQuoteId = sent.data.id;
  const sentLines = await admin.from("quote_line_items").insert([
    {
      organisation_id: orgAId,
      quote_id: sentQuoteId,
      position: 1,
      description: `Overhaul works ${run}`,
      quantity: 1,
      unit_price_pence: 159970,
      vat_rate: 20,
    },
    {
      organisation_id: orgAId,
      quote_id: sentQuoteId,
      position: 2,
      description: `Zero-rated documentation ${run}`,
      quantity: 1,
      unit_price_pence: 5000,
      vat_rate: 0,
    },
  ]);
  if (sentLines.error) throw new Error(sentLines.error.message);

  const draft = await admin
    .from("quotes")
    .insert({
      organisation_id: orgAId,
      customer_id: customer.data.id,
      quote_number: 2,
      title: `Draft job ${run}`,
      status: "draft",
    })
    .select("id")
    .single();
  if (draft.error) throw new Error(draft.error.message);
});

test.afterAll(async () => {
  await admin
    .from("audit_log")
    .delete()
    .in("organisation_id", [orgAId, orgNId]);
  await admin.from("quotes").delete().in("organisation_id", [orgAId, orgNId]);
  await admin.from("organisations").delete().in("id", [orgAId, orgNId]);
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

test("entitled member sees the list, filter and detail with formatted money", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  const navLink = page
    .getByRole("navigation", { name: "Modules" })
    .getByRole("link", { name: "Quotes" });
  await expect(navLink).toBeVisible();
  await navLink.click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/quotes$`));

  // List: number with title, customer, status badge, formatted total.
  await expect(page.getByText(`#1 Crane overhaul ${run}`)).toBeVisible();
  await expect(page.getByText(`Big Crane Co ${run}`).first()).toBeVisible();
  await expect(page.getByText("£1,969.64")).toBeVisible();
  await expect(page.getByText(`#2 Draft job ${run}`)).toBeVisible();
  await expect(page.getByText("£0.00")).toBeVisible();

  // The status filter narrows the list.
  await page.getByRole("link", { name: "Sent", exact: true }).click();
  await expect(page.getByText(`#1 Crane overhaul ${run}`)).toBeVisible();
  await expect(page.getByText(`#2 Draft job ${run}`)).toHaveCount(0);
  await page.getByRole("link", { name: "Draft", exact: true }).click();
  await expect(page.getByText(`#2 Draft job ${run}`)).toBeVisible();
  await expect(page.getByText(`#1 Crane overhaul ${run}`)).toHaveCount(0);

  // Detail: header, lines in order, summary money via the helper.
  await page.getByRole("link", { name: "All", exact: true }).click();
  await page.getByRole("link", { name: `#1 Crane overhaul ${run}` }).click();
  await expect(page).toHaveURL(
    new RegExp(`/app/${slugA}/quotes/[0-9a-f-]{36}$`)
  );
  await expect(
    page.getByRole("heading", { name: `Quote #1 Crane overhaul ${run}` })
  ).toBeVisible();
  await expect(page.getByText(`Overhaul works ${run}`)).toBeVisible();
  await expect(page.getByText(`Zero-rated documentation ${run}`)).toBeVisible();
  await expect(page.getByText("£1,599.70").first()).toBeVisible();
  await expect(page.getByText("£1,649.70")).toBeVisible();
  await expect(page.getByText("£319.94")).toBeVisible();
  await expect(page.getByText("£1,969.64")).toBeVisible();
});

test("read_only member can view the list and detail", async ({ page }) => {
  await signIn(page, "readonly-a");
  await page.goto(`/app/${slugA}/quotes`);
  await expect(page.getByText(`#1 Crane overhaul ${run}`)).toBeVisible();
  await page.goto(`/app/${slugA}/quotes/${sentQuoteId}`);
  await expect(page.getByText(`Overhaul works ${run}`)).toBeVisible();
});

test("unentitled organisation: no nav item, pages send the member away", async ({
  page,
}) => {
  await signIn(page, "staff-n");
  await expect(page).toHaveURL(new RegExp(`/app/${slugN}$`));

  await expect(
    page
      .getByRole("navigation", { name: "Modules" })
      .getByRole("link", { name: "Quotes" })
  ).toHaveCount(0);

  await page.goto(`/app/${slugN}/quotes`);
  await expect(page).toHaveURL(new RegExp(`/app/${slugN}$`));
  await page.goto(`/app/${slugN}/quotes/${crypto.randomUUID()}`);
  await expect(page).toHaveURL(new RegExp(`/app/${slugN}$`));
});
