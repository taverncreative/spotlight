// Route-level access control test for Pass 0C. Runs with: npm run test:routes
//
// Drives the real app in a browser against the local Supabase stack: real
// login form, real session cookies, real workspace routes. Creates two
// organisations and one user (a member of organisation A only), then proves
// the four required behaviours and cleans up after itself.

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const email = `member-${run}@routes.test`;
const password = `Test-${crypto.randomUUID()}`;
const slugA = `route-a-${run}`;
const slugB = `route-b-${run}`;
const orgAName = `Route Org A ${run}`;
const orgBName = `Route Org B ${run}`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let orgAId: string;
let orgBId: string;
let userId: string;

test.beforeAll(async () => {
  const orgA = await admin
    .from("organisations")
    .insert({ name: orgAName, slug: slugA })
    .select("id")
    .single();
  const orgB = await admin
    .from("organisations")
    .insert({ name: orgBName, slug: slugB })
    .select("id")
    .single();
  if (orgA.error || orgB.error) {
    throw new Error(orgA.error?.message ?? orgB.error?.message);
  }
  orgAId = orgA.data.id;
  orgBId = orgB.data.id;

  const user = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (user.error || !user.data.user) {
    throw new Error(user.error?.message ?? "no user returned");
  }
  userId = user.data.user.id;

  const membership = await admin.from("organisation_memberships").insert({
    organisation_id: orgAId,
    user_id: userId,
    role: "staff",
    status: "active",
  });
  if (membership.error) throw new Error(membership.error.message);
});

test.afterAll(async () => {
  await admin.from("organisations").delete().in("id", [orgAId, orgBId]);
  await admin.auth.admin.deleteUser(userId);
});

test("signed-out visitor to a workspace is redirected to login", async ({
  page,
}) => {
  await page.goto(`/app/${slugA}`);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("wrong password shows a clear error and no session", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  // Next.js adds its own role="alert" route announcer, so locate by text.
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("member gets in, cross-tenant is denied, sign-out closes access", async ({
  page,
}) => {
  // Sign in through the real form; single membership lands in workspace A.
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}$`));
  await expect(page.getByRole("heading", { name: orgAName })).toBeVisible();
  // The signed-in user shows in the workspace frame's top bar.
  await expect(page.getByText(email)).toBeVisible();

  // The same signed-in user is denied at organisation B with a 404.
  const denied = await page.goto(`/app/${slugB}`);
  expect(denied?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: orgBName })).toHaveCount(0);

  // Sign out from workspace A, then the workspace is no longer reachable.
  await page.goto(`/app/${slugA}`);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(`/app/${slugA}`);
  await expect(page).toHaveURL(/\/login$/);
});
