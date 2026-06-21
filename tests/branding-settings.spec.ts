// Branding settings screen test. Runs with: npm run test:branding
//
// The admin-only branding settings: a client_admin sees the Settings nav, opens
// Branding, has an invalid colour rejected and a valid one saved (persisted to
// organisations.brand_color); a non-admin sees no Settings entry and is
// redirected away from the URL. The DB-level enforcement (admin-only,
// column-scoped, own-org) is proven separately by npm run test:admin-config-rls.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slug = `branding-${run}`;
const emailFor = (label: string) => `${label}-${run}@branding.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let orgId: string;
const userIds: string[] = [];

test.beforeAll(async () => {
  const org = await admin
    .from("organisations")
    .insert({ name: `Acme Lifting ${run}`, slug })
    .select("id")
    .single();
  if (org.error) throw new Error(org.error.message);
  orgId = org.data.id;

  for (const [label, role] of [
    ["admin", "client_admin"],
    ["staff", "staff"],
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
});

test.afterAll(async () => {
  await admin.from("organisations").delete().eq("id", orgId);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
});

async function signIn(page: Page, label: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(emailFor(label));
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\//);
}

test("a client_admin sees Settings, an invalid colour is rejected and a valid one saves", async ({
  page,
}) => {
  await signIn(page, "admin");

  // The admin sees the Settings nav entry.
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();

  await page.goto(`/app/${slug}/settings/branding`);
  await expect(
    page.getByRole("heading", { name: "Branding", level: 1, exact: true })
  ).toBeVisible();

  const field = page.getByRole("textbox", {
    name: "Brand colour",
    exact: true,
  });

  // An invalid colour is rejected and nothing is persisted.
  await field.fill("nothex");
  await page.getByRole("button", { name: "Save brand colour" }).click();
  await expect(page.getByText(/valid hex colour/i)).toBeVisible();
  const afterInvalid = await admin
    .from("organisations")
    .select("brand_color")
    .eq("id", orgId)
    .single();
  expect(afterInvalid.data?.brand_color).toBeNull();

  // A valid colour saves, confirms, and is persisted.
  await field.fill("#22aa44");
  await page.getByRole("button", { name: "Save brand colour" }).click();
  await expect(page.getByText(/Brand colour saved/i)).toBeVisible();
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("organisations")
        .select("brand_color")
        .eq("id", orgId)
        .single();
      return data?.brand_color;
    })
    .toBe("#22aa44");
});

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

test("a client_admin uploads a logo, has non-images rejected, and can clear it", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto(`/app/${slug}/settings/branding`);

  const fileInput = page.locator('input[name="logo"]');

  // An SVG (not a raster) is rejected on its real content, not its name.
  await fileInput.setInputFiles({
    name: "logo.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  });
  await page.getByRole("button", { name: "Upload logo" }).click();
  await expect(page.getByText(/Only PNG or JPEG/i)).toBeVisible();

  // An oversized image is rejected (the cap is 2 MB).
  await fileInput.setInputFiles({
    name: "huge.png",
    mimeType: "image/png",
    buffer: Buffer.concat([PNG_SIGNATURE, Buffer.alloc(2 * 1024 * 1024 + 16)]),
  });
  await page.getByRole("button", { name: "Upload logo" }).click();
  await expect(page.getByText(/2 MB or smaller/i)).toBeVisible();

  // Nothing invalid was persisted.
  const afterRejects = await admin
    .from("organisations")
    .select("logo_url")
    .eq("id", orgId)
    .single();
  expect(afterRejects.data?.logo_url).toBeNull();

  // A valid PNG uploads, confirms, and is stored as a logos-bucket public URL.
  await fileInput.setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.concat([PNG_SIGNATURE, Buffer.alloc(64)]),
  });
  await page.getByRole("button", { name: "Upload logo" }).click();
  await expect(page.getByText(/Logo saved/i)).toBeVisible();
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("organisations")
        .select("logo_url")
        .eq("id", orgId)
        .single();
      return data?.logo_url ?? "";
    })
    .toContain("/storage/v1/object/public/logos/");

  // Clearing removes the logo.
  await page.getByRole("button", { name: "Remove logo" }).click();
  await expect(page.getByText(/Logo removed/i)).toBeVisible();
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("organisations")
        .select("logo_url")
        .eq("id", orgId)
        .single();
      return data?.logo_url;
    })
    .toBeNull();
});

test("a non-admin has no Settings entry and cannot reach the branding page", async ({
  page,
}) => {
  await signIn(page, "staff");

  // No Settings nav entry for a non-admin.
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);

  // Direct navigation is sent back to the workspace overview.
  await page.goto(`/app/${slug}/settings/branding`);
  await expect(page).toHaveURL(`/app/${slug}`);
  await expect(
    page.getByRole("heading", { name: "Branding", level: 1, exact: true })
  ).toHaveCount(0);
});
