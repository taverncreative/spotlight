// Templates screen test for Pass 9B. Runs with:
// npm run test:templates-screen
//
// Drives the Templates area through a real browser. A write-capable user sees
// the seeded templates, narrows them with the category filter, and creates,
// edits and deletes a template. The create form's live preview fills the
// catalogue's sample data into the placeholders and updates as the body is
// edited, and an unrecognised token raises a gentle warning. The Templates
// sidebar entry shows in an organisation with the templates module and is absent
// in one without it. A read_only user sees the list but none of the controls.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `tsc-a-${run}`;
const slugN = `tsc-n-${run}`;
const emailFor = (label: string) => `${label}-${run}@templates-screen.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
const planIds: string[] = [];

const seeded = {
  quoteSent: `Quote sent seed ${run}`,
  general: `General seed ${run}`,
};

async function makePlan(modules: string[], orgLabel: string) {
  const plan = await admin
    .from("plans")
    .insert({ key: `tsc-${orgLabel}-${run}`, name: "TSC", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planIds.push(plan.data.id);
  for (const moduleKey of modules) {
    const linked = await admin
      .from("plan_modules")
      .insert({ plan_id: plan.data.id, module: moduleKey });
    if (linked.error) throw new Error(linked.error.message);
  }
  const assigned = await admin.rpc("assign_plan", {
    org_id: orgIds[orgLabel],
    new_plan_id: plan.data.id,
  });
  if (assigned.error) throw new Error(assigned.error.message);
}

async function makeUser(label: string, memberships: Array<[string, string]>) {
  const user = await admin.auth.admin.createUser({
    email: emailFor(label),
    password,
    email_confirm: true,
  });
  if (user.error || !user.data.user) throw new Error(user.error?.message);
  userIds.push(user.data.user.id);
  for (const [orgLabel, role] of memberships) {
    const membership = await admin.from("organisation_memberships").insert({
      organisation_id: orgIds[orgLabel],
      user_id: user.data.user.id,
      role,
      status: "active",
    });
    if (membership.error) throw new Error(membership.error.message);
  }
  return user.data.user.id;
}

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["n", slugN],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Templates Screen ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  // A has templates; N has leads only, so it is a valid workspace whose sidebar
  // must not show Templates.
  await makePlan(["templates"], "a");
  await makePlan(["leads"], "n");

  // The write user belongs to both organisations; the read user to A only.
  await makeUser("write", [
    ["a", "staff"],
    ["n", "staff"],
  ]);
  await makeUser("read", [["a", "read_only"]]);

  const seed = await admin.from("templates").insert([
    {
      organisation_id: orgIds.a,
      name: seeded.quoteSent,
      category: "quote_sent",
      subject: "Quote {{quote_number}}",
      body: "Hi {{contact_name}}, your quote is {{quote_total}}.",
    },
    {
      organisation_id: orgIds.a,
      name: seeded.general,
      category: "general",
      body: "A general note.",
    },
  ]);
  if (seed.error) throw new Error(seed.error.message);
});

test.afterAll(async () => {
  const ids = Object.values(orgIds);
  await admin.from("audit_log").delete().in("organisation_id", ids);
  await admin.from("organisations").delete().in("id", ids);
  await admin.from("plans").delete().in("id", planIds);
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

test("the list shows the templates and the category filter narrows them", async ({
  page,
}) => {
  await signIn(page, "write");
  await page.goto(`/app/${slugA}/templates`);

  await expect(page.getByRole("heading", { name: "Templates", level: 1 })).toBeVisible();
  await expect(page.getByText(seeded.quoteSent)).toBeVisible();
  await expect(page.getByText(seeded.general)).toBeVisible();

  // Filtering by the Quote sent category narrows to that template.
  await page.getByRole("link", { name: "Quote sent", exact: true }).click();
  await expect(page).toHaveURL(/category=quote_sent/);
  await expect(page.getByText(seeded.quoteSent)).toBeVisible();
  await expect(page.getByText(seeded.general)).toHaveCount(0);
});

test("a write user can create, edit and delete a template", async ({ page }) => {
  await signIn(page, "write");
  await page.goto(`/app/${slugA}/templates`);

  // Create.
  const name = `Created ${run}`;
  await page.getByRole("link", { name: "New template" }).click();
  await expect(page).toHaveURL(/\/templates\/new$/);
  // Exact match: the placeholder insert buttons ({{contact_name}} and friends)
  // would otherwise also match a substring "Name".
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Category").selectOption("quote_chase");
  await page.getByLabel("Subject").fill("Chasing {{quote_number}}");
  await page.getByLabel("Body").fill("Hi {{contact_name}}, just chasing your quote.");
  await page.getByRole("button", { name: "Create template" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/templates$`));
  await expect(page.getByText(name)).toBeVisible();

  // Edit the name.
  const edited = `Edited ${run}`;
  const row = () => page.locator("tr", { hasText: name });
  await row().getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.getByLabel("Name", { exact: true }).fill(edited);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/templates$`));
  await expect(page.getByText(edited)).toBeVisible();

  // Delete behind the permanent-delete confirm.
  const editedRow = page.locator("tr", { hasText: edited });
  await editedRow.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete template" }).click();
  await expect(page.getByText(edited)).toHaveCount(0);
});

test("the create form's live preview fills sample data and an unrecognised token warns", async ({
  page,
}) => {
  await signIn(page, "write");
  await page.goto(`/app/${slugA}/templates/new`);

  const preview = page.getByRole("region", { name: "Preview" });

  // A known token is filled with the catalogue's sample value.
  await page.getByLabel("Body").fill("Hi {{contact_name}}");
  await expect(preview.getByText("Hi Dave Hughes")).toBeVisible();
  await expect(page.getByText(/Unrecognised/i)).toHaveCount(0);

  // Editing the body updates the preview.
  await page.getByLabel("Body").fill("Total {{quote_total}}");
  await expect(preview.getByText("Total £1,200.00")).toBeVisible();

  // An unrecognised token renders empty in the preview and raises the warning.
  await page.getByLabel("Body").fill("Hello {{contact_name}} and {{mystery_token}}");
  await expect(preview.getByText("Hello Dave Hughes and")).toBeVisible();
  const warning = page.getByText(/Unrecognised/i);
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("{{mystery_token}}");
});

test("the Templates sidebar entry shows only when the module is enabled", async ({
  page,
}) => {
  await signIn(page, "write");
  const sidebar = page.getByRole("navigation", { name: "Modules" });

  await page.goto(`/app/${slugA}`);
  await expect(sidebar.getByRole("link", { name: "Templates" })).toBeVisible();

  await page.goto(`/app/${slugN}`);
  await expect(sidebar.getByRole("link", { name: "Leads" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Templates" })).toHaveCount(0);
});

test("a read_only user sees the list but none of the controls", async ({ page }) => {
  await signIn(page, "read");
  await page.goto(`/app/${slugA}/templates`);

  await expect(page.getByText(seeded.quoteSent)).toBeVisible();
  await expect(page.getByText(seeded.general)).toBeVisible();

  await expect(page.getByRole("link", { name: "New template" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
});
