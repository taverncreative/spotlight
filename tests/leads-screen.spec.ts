// Leads list screen test for Pass 1C. Runs with: npm run test:leads-screen
//
// Organisation A has the leads module via a real assign_plan call and two
// seeded leads; organisation N has no entitlements. Proves the
// entitlement-driven sidebar, the list table, read_only visibility, and
// that an unentitled organisation neither sees the nav item nor reaches
// the leads screen directly.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `ls-a-${run}`;
const slugN = `ls-n-${run}`;
const emailFor = (label: string) => `${label}-${run}@leads-screen.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let orgAId: string;
let orgNId: string;
let planId: string;
const userIds: string[] = [];

test.beforeAll(async () => {
  const orgA = await admin
    .from("organisations")
    .insert({ name: `Screen Org A ${run}`, slug: slugA })
    .select("id")
    .single();
  const orgN = await admin
    .from("organisations")
    .insert({ name: `Screen Org N ${run}`, slug: slugN })
    .select("id")
    .single();
  if (orgA.error || orgN.error) {
    throw new Error(orgA.error?.message ?? orgN.error?.message);
  }
  orgAId = orgA.data.id;
  orgNId = orgN.data.id;

  const plan = await admin
    .from("plans")
    .insert({ key: `ls-${run}`, name: "LS", monthly_price_pence: 1000 })
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
  // Organisation N deliberately gets no entitlements.

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

  const seeded = await admin.from("leads").insert([
    {
      organisation_id: orgAId,
      name: `Seeded lead one ${run}`,
      email: "one@example.com",
      status: "new",
    },
    {
      organisation_id: orgAId,
      name: `Seeded lead two ${run}`,
      email: "two@example.com",
      status: "contacted",
    },
  ]);
  if (seeded.error) throw new Error(seeded.error.message);
});

test.afterAll(async () => {
  await admin
    .from("audit_log")
    .delete()
    .in("organisation_id", [orgAId, orgNId]);
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

test("entitled member sees Leads in the sidebar and the seeded table", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  const navLink = page
    .getByRole("navigation", { name: "Modules" })
    .getByRole("link", { name: "Leads" });
  await expect(navLink).toBeVisible();
  await navLink.click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/leads$`));

  await expect(page.getByText(`Seeded lead one ${run}`)).toBeVisible();
  await expect(page.getByText(`Seeded lead two ${run}`)).toBeVisible();
  // exact: true picks the lowercase status badge, not the Contacted pill.
  await expect(page.getByText("contacted", { exact: true })).toBeVisible();

  // The status filter narrows the table, and an empty status shows the
  // empty state.
  await page.getByRole("link", { name: "New", exact: true }).click();
  await expect(page.getByText(`Seeded lead one ${run}`)).toBeVisible();
  await expect(page.getByText(`Seeded lead two ${run}`)).toHaveCount(0);
  await page.goto(`/app/${slugA}/leads?status=spam`);
  await expect(page.getByText("No spam leads.")).toBeVisible();
});

test("read_only member can view the list", async ({ page }) => {
  await signIn(page, "readonly-a");
  await page.goto(`/app/${slugA}/leads`);
  await expect(page.getByText(`Seeded lead one ${run}`)).toBeVisible();
});

test("unentitled organisation: no nav item, direct visit is sent away", async ({
  page,
}) => {
  await signIn(page, "staff-n");
  await expect(page).toHaveURL(new RegExp(`/app/${slugN}$`));

  await expect(
    page
      .getByRole("navigation", { name: "Modules" })
      .getByRole("link", { name: "Leads" })
  ).toHaveCount(0);

  await page.goto(`/app/${slugN}/leads`);
  await expect(page).toHaveURL(new RegExp(`/app/${slugN}$`));
  // The workspace home is the dashboard; landing there confirms the redirect.
  await expect(
    page.getByText("An overview of your workspace")
  ).toBeVisible();
});
