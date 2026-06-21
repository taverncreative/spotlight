// Authorisation gate test for Pass 0E. Runs with: npm run test:authz
//
// Seeds two organisations whose entitlements come from a real assign_plan
// call (module: leads), four real users holding each organisation role in
// organisation A, then signs in as each through the real login form and
// exercises the stub gate route, which composes requireWorkspaceAccess,
// requireModuleEnabled and requirePermission in the standard order.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `authz-a-${run}`;
const slugB = `authz-b-${run}`;

const ROLES = ["read_only", "staff", "manager", "client_admin"] as const;
const emailFor = (role: string) => `${role}-${run}@authz.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let orgAId: string;
let orgBId: string;
let planId: string;
const userIds: string[] = [];

test.beforeAll(async () => {
  const orgA = await admin
    .from("organisations")
    .insert({ name: `Authz Org A ${run}`, slug: slugA })
    .select("id")
    .single();
  const orgB = await admin
    .from("organisations")
    .insert({ name: `Authz Org B ${run}`, slug: slugB })
    .select("id")
    .single();
  if (orgA.error || orgB.error) {
    throw new Error(orgA.error?.message ?? orgB.error?.message);
  }
  orgAId = orgA.data.id;
  orgBId = orgB.data.id;

  // Entitlements come from a real plan assignment, not direct inserts.
  const plan = await admin
    .from("plans")
    .insert({ key: `authz-${run}`, name: "Authz", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planId = plan.data.id;
  const linked = await admin
    .from("plan_modules")
    .insert({ plan_id: planId, module: "leads" });
  if (linked.error) throw new Error(linked.error.message);

  for (const orgId of [orgAId, orgBId]) {
    const assigned = await admin.rpc("assign_plan", {
      org_id: orgId,
      new_plan_id: planId,
    });
    if (assigned.error) throw new Error(assigned.error.message);
  }

  for (const role of ROLES) {
    const user = await admin.auth.admin.createUser({
      email: emailFor(role),
      password,
      email_confirm: true,
    });
    if (user.error || !user.data.user) {
      throw new Error(user.error?.message ?? "no user returned");
    }
    userIds.push(user.data.user.id);
    const membership = await admin.from("organisation_memberships").insert({
      organisation_id: orgAId,
      user_id: user.data.user.id,
      role,
      status: "active",
    });
    if (membership.error) throw new Error(membership.error.message);
  }
});

test.afterAll(async () => {
  await admin
    .from("audit_log")
    .delete()
    .in("organisation_id", [orgAId, orgBId]);
  await admin.from("organisations").delete().in("id", [orgAId, orgBId]);
  await admin.from("plans").delete().eq("id", planId);
  for (const id of userIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

async function signIn(page: Page, role: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(emailFor(role));
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}$`));
}

// page.request shares the browser context's session cookies.
async function gate(
  page: Page,
  capability: string,
  opts: { slug?: string; module?: string } = {}
) {
  const response = await page.request.post(
    `/api/stub-gate/${opts.slug ?? slugA}`,
    { data: { module: opts.module ?? "leads", capability } }
  );
  return response.status();
}

test("read_only: record.read allowed, record.write denied", async ({
  page,
}) => {
  await signIn(page, "read_only");
  expect(await gate(page, "record.read")).toBe(200);
  expect(await gate(page, "record.write")).toBe(403);
});

test("staff: record.write allowed, settings and users denied", async ({
  page,
}) => {
  await signIn(page, "staff");
  expect(await gate(page, "record.write")).toBe(200);
  expect(await gate(page, "settings.manage")).toBe(403);
  expect(await gate(page, "users.manage")).toBe(403);
});

test("manager: record.write allowed, settings denied", async ({ page }) => {
  await signIn(page, "manager");
  expect(await gate(page, "record.write")).toBe(200);
  expect(await gate(page, "settings.manage")).toBe(403);
});

test("client_admin: settings and users allowed", async ({ page }) => {
  await signIn(page, "client_admin");
  expect(await gate(page, "settings.manage")).toBe(200);
  expect(await gate(page, "users.manage")).toBe(200);
});

test("module without entitlement is denied even for client_admin", async ({
  page,
}) => {
  await signIn(page, "client_admin");
  expect(await gate(page, "record.read", { module: "automations" })).toBe(403);
  expect(await gate(page, "settings.manage", { module: "automations" })).toBe(
    403
  );
});

test("member of organisation A is denied at organisation B", async ({
  page,
}) => {
  await signIn(page, "client_admin");
  expect(await gate(page, "record.read", { slug: slugB })).toBe(404);
});
