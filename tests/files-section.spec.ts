// Per-record files section test for Pass 8C. Runs with:
// npm run test:files-section
//
// Drives the files section that now sits on the lead, customer and quote detail
// pages. A write user sees the section, uploads a small file the browser-direct
// way (it appears with the right filename and size), downloads it (the bytes
// match what was uploaded), and deletes it (gone from the list and from
// storage). An oversized file is rejected with a friendly message before any
// upload. A read_only user sees the list and can download, but has no upload or
// delete controls.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const BUCKET = "attachments";
const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slug = `fsec-${run}`;
const emailFor = (label: string) => `${label}-${run}@files-section.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let orgId: string;
let customerId: string;
let quoteId: string;
let writeUserId: string;
const userIds: string[] = [];
let planId: string;

const seededName = `seeded-${run}.txt`;
const seededContent = `Seeded file contents ${run}\n`;
let seededPath: string;

test.beforeAll(async () => {
  const org = await admin
    .from("organisations")
    .insert({ name: `Files Section ${run}`, slug })
    .select("id")
    .single();
  if (org.error) throw new Error(org.error.message);
  orgId = org.data.id;

  // The detail pages live under the customers and quotes modules; files are
  // gated by the record's module, so those two are all that is needed.
  const plan = await admin
    .from("plans")
    .insert({ key: `fsec-${run}`, name: "FSEC", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planId = plan.data.id;
  for (const moduleKey of ["customers", "quotes"]) {
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
    if (label === "write") writeUserId = user.data.user.id;
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
    .insert({ organisation_id: orgId, name: `Section customer ${run}`, type: "business" })
    .select("id")
    .single();
  if (customer.error) throw new Error(customer.error.message);
  customerId = customer.data.id;

  const quote = await admin
    .from("quotes")
    .insert({
      organisation_id: orgId,
      customer_id: customerId,
      quote_number: 1,
      title: "Section quote",
      status: "draft",
    })
    .select("id")
    .single();
  if (quote.error) throw new Error(quote.error.message);
  quoteId = quote.data.id;

  // One file on the customer, placed by the admin (object plus metadata row),
  // authored by the write user. It proves the list and the download for a
  // read_only user, and persists through the write tests (which act on their
  // own uploads).
  seededPath = `${orgId}/customer/${customerId}/${crypto.randomUUID()}-${seededName}`;
  const upload = await admin.storage
    .from(BUCKET)
    .upload(seededPath, new Blob([seededContent], { type: "text/plain" }), {
      contentType: "text/plain",
    });
  if (upload.error) throw new Error(upload.error.message);
  const fileRow = await admin.from("files").insert({
    organisation_id: orgId,
    related_type: "customer",
    related_id: customerId,
    filename: seededName,
    storage_path: seededPath,
    size_bytes: Buffer.byteLength(seededContent, "utf8"),
    mime_type: "text/plain",
    created_by: writeUserId,
    updated_by: writeUserId,
  });
  if (fileRow.error) throw new Error(fileRow.error.message);
});

test.afterAll(async () => {
  // Remove every stored object the run created (org delete cascades the rows
  // but not the objects), then the org and the rest.
  const leftover = await admin
    .from("files")
    .select("storage_path")
    .eq("organisation_id", orgId);
  const paths = (leftover.data ?? []).map((f) => f.storage_path);
  if (paths.length) await admin.storage.from(BUCKET).remove(paths);

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

// The files section, located by its heading, for scoping queries to it.
function filesSection(page: Page) {
  return page.locator("section", {
    has: page.getByRole("heading", { name: "Files", exact: true }),
  });
}

test("customer detail: a write user uploads, downloads and deletes a file in place", async ({
  page,
}) => {
  await signIn(page, "write");
  await page.goto(`/app/${slug}/customers/${customerId}`);

  await expect(
    page.getByRole("heading", { name: "Files", level: 2 })
  ).toBeVisible();
  // The seeded file is listed.
  await expect(filesSection(page).getByText(seededName)).toBeVisible();

  // Upload a small file the browser-direct way.
  const uploadName = `upload-${crypto.randomUUID().slice(0, 8)}.txt`;
  const uploadContent = `Uploaded from the customer page ${run}\n`;
  const uploadBytes = Buffer.byteLength(uploadContent, "utf8");
  await page
    .getByLabel("Choose a file")
    .setInputFiles({
      name: uploadName,
      mimeType: "text/plain",
      buffer: Buffer.from(uploadContent),
    });
  await filesSection(page).getByRole("button", { name: "Upload" }).click();

  // It appears in the list with the right filename and size. Scope to the list
  // items, since the upload success message also mentions the filename.
  const card = filesSection(page)
    .locator("ul > li")
    .filter({ hasText: uploadName });
  await expect(card).toBeVisible();
  await expect(card).toContainText(`${uploadBytes} B`);

  // The metadata row and the stored object both exist; capture the path so the
  // delete can be proven against storage.
  const rowAfterUpload = await admin
    .from("files")
    .select("storage_path")
    .eq("organisation_id", orgId)
    .eq("filename", uploadName)
    .single();
  expect(rowAfterUpload.error).toBeNull();
  const uploadedPath = rowAfterUpload.data!.storage_path as string;
  expect(uploadedPath.startsWith(`${orgId}/customer/${customerId}/`)).toBe(true);

  // Download it: the bytes match what was uploaded.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    card.getByRole("button", { name: "Download" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(uploadName);
  const downloadPath = await download.path();
  expect(readFileSync(downloadPath).toString("utf8")).toBe(uploadContent);

  // Delete it behind the permanent-delete confirm; the card leaves the list once
  // the delete completes and the section revalidates.
  await card.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete file" }).click();
  await expect(
    filesSection(page).locator("ul > li").filter({ hasText: uploadName })
  ).toHaveCount(0);

  // The row is gone and so is the stored object. Poll, to wait out the server
  // action's commit rather than race it.
  await expect
    .poll(async () => {
      const r = await admin
        .from("files")
        .select("id")
        .eq("organisation_id", orgId)
        .eq("filename", uploadName);
      return r.data?.length ?? 0;
    })
    .toBe(0);
  await expect
    .poll(async () => {
      const object = await admin.storage.from(BUCKET).download(uploadedPath);
      return object.error ? "gone" : "present";
    })
    .toBe("gone");
});

test("quote detail: the section appears and a write user uploads a file linked to the quote", async ({
  page,
}) => {
  await signIn(page, "write");
  await page.goto(`/app/${slug}/quotes/${quoteId}`);
  await expect(
    page.getByRole("heading", { name: "Files", level: 2 })
  ).toBeVisible();

  const uploadName = `quote-${crypto.randomUUID().slice(0, 8)}.txt`;
  await page
    .getByLabel("Choose a file")
    .setInputFiles({
      name: uploadName,
      mimeType: "text/plain",
      buffer: Buffer.from(`Quote attachment ${run}\n`),
    });
  await filesSection(page).getByRole("button", { name: "Upload" }).click();

  // It appears in the quote's section, which lists only this quote's files, so
  // its presence proves the file is linked to this quote.
  await expect(
    filesSection(page).locator("ul > li").filter({ hasText: uploadName })
  ).toBeVisible();
  const linked = await admin
    .from("files")
    .select("related_type, related_id")
    .eq("organisation_id", orgId)
    .eq("filename", uploadName)
    .single();
  expect(linked.data?.related_type).toBe("quote");
  expect(linked.data?.related_id).toBe(quoteId);
});

test("an oversized file is rejected with a friendly message and is not uploaded", async ({
  page,
}) => {
  await signIn(page, "write");
  await page.goto(`/app/${slug}/customers/${customerId}`);

  const oversizedName = `huge-${crypto.randomUUID().slice(0, 8)}.bin`;
  // 26 MiB, over the 25 MiB limit.
  const oversized = Buffer.alloc(26 * 1024 * 1024);
  await page
    .getByLabel("Choose a file")
    .setInputFiles({
      name: oversizedName,
      mimeType: "application/octet-stream",
      buffer: oversized,
    });
  await filesSection(page).getByRole("button", { name: "Upload" }).click();

  await expect(
    filesSection(page).getByText(/too large.*25 MiB/i)
  ).toBeVisible();
  // Nothing was recorded for it.
  await expect(filesSection(page).getByText(oversizedName)).toHaveCount(0);
  const notRecorded = await admin
    .from("files")
    .select("id")
    .eq("organisation_id", orgId)
    .eq("filename", oversizedName);
  expect(notRecorded.data?.length ?? 0).toBe(0);
});

test("a read_only user sees the list and can download but has no upload or delete controls", async ({
  page,
}) => {
  await signIn(page, "read");
  await page.goto(`/app/${slug}/customers/${customerId}`);

  await expect(
    page.getByRole("heading", { name: "Files", level: 2 })
  ).toBeVisible();
  const section = filesSection(page);
  await expect(section.getByText(seededName)).toBeVisible();

  // Download works for read_only: the bytes match the seeded contents.
  const card = page.locator("li", { hasText: seededName });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    card.getByRole("button", { name: "Download" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(seededName);
  const downloadPath = await download.path();
  expect(readFileSync(downloadPath).toString("utf8")).toBe(seededContent);

  // None of the write controls.
  await expect(page.getByLabel("Choose a file")).toHaveCount(0);
  await expect(section.getByRole("button", { name: "Upload" })).toHaveCount(0);
  await expect(section.getByRole("button", { name: "Delete" })).toHaveCount(0);
});
