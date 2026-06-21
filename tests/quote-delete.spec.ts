// Quote delete and restore test for Pass 3H. Runs with:
// npm run test:quote-delete
//
// Deletes a SENT quote through the dialog (the less obvious case), proves
// it leaves the active list, appears in the deleted view, both its detail
// and builder URLs show the calm state, restore returns it still sent with
// editing still locked, and both moves are audited. read_only sees neither
// control and is denied server-side.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `qd-a-${run}`;
const emailFor = (label: string) => `${label}-${run}@quote-delete.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let orgAId: string;
let planId: string;
let sentQuoteId: string;
let keptQuoteId: string;
const userIds: string[] = [];

test.beforeAll(async () => {
  const orgA = await admin
    .from("organisations")
    .insert({ name: `Delete Quotes A ${run}`, slug: slugA })
    .select("id")
    .single();
  if (orgA.error) throw new Error(orgA.error.message);
  orgAId = orgA.data.id;

  const plan = await admin
    .from("plans")
    .insert({ key: `qd-${run}`, name: "QD", monthly_price_pence: 1000 })
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
    .insert({ organisation_id: orgAId, name: `Deleted Quote Co ${run}` })
    .select("id")
    .single();
  if (customer.error) throw new Error(customer.error.message);

  const sent = await admin
    .from("quotes")
    .insert({
      organisation_id: orgAId,
      customer_id: customer.data.id,
      quote_number: 1,
      title: `Sent quote ${run}`,
      status: "sent",
      issued_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (sent.error) throw new Error(sent.error.message);
  sentQuoteId = sent.data.id;

  const kept = await admin
    .from("quotes")
    .insert({
      organisation_id: orgAId,
      customer_id: customer.data.id,
      quote_number: 2,
      title: `Kept quote ${run}`,
    })
    .select("id")
    .single();
  if (kept.error) throw new Error(kept.error.message);
  keptQuoteId = kept.data.id;
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

test("staff deletes a sent quote, restores it still sent and locked", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  // Delete from the detail through the shared dialog.
  await page.goto(`/app/${slugA}/quotes/${sentQuoteId}`);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("alertdialog").getByText("can restore it")
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete quote" }).click();

  // Back on the list; gone from active, present in the deleted view.
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/quotes$`));
  await expect(page.getByText(`Kept quote ${run}`)).toBeVisible();
  await expect(page.getByText(`Sent quote ${run}`)).toHaveCount(0);
  await page.getByRole("link", { name: "Deleted quotes" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/quotes/deleted$`));
  await expect(page.getByText(`Sent quote ${run}`)).toBeVisible();
  await expect(page.getByText("sent", { exact: true })).toBeVisible();

  // Detail and builder URLs both show the calm state.
  await page.goto(`/app/${slugA}/quotes/${sentQuoteId}`);
  await expect(
    page.getByText("This quote is no longer available.")
  ).toBeVisible();
  await page.goto(`/app/${slugA}/quotes/${sentQuoteId}/edit`);
  await expect(
    page.getByText("This quote is no longer available.")
  ).toBeVisible();

  // Audited (service role).
  const deletedAudit = await admin
    .from("audit_log")
    .select("id")
    .eq("organisation_id", orgAId)
    .eq("target_id", sentQuoteId)
    .eq("action", "quote.soft_deleted");
  expect(deletedAudit.data?.length).toBe(1);

  // Restore: back in the active list, still sent, editing still locked.
  await page.goto(`/app/${slugA}/quotes/deleted`);
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("No deleted quotes.")).toBeVisible();
  const restored = await admin
    .from("quotes")
    .select("status, issued_at, deleted_at")
    .eq("id", sentQuoteId)
    .single();
  expect(restored.data?.status).toBe("sent");
  expect(restored.data?.issued_at).not.toBeNull();
  expect(restored.data?.deleted_at).toBeNull();
  await page.goto(`/app/${slugA}/quotes`);
  await expect(page.getByText(`Sent quote ${run}`)).toBeVisible();
  await page.goto(`/app/${slugA}/quotes/${sentQuoteId}/edit`);
  await expect(page).toHaveURL(
    new RegExp(`/app/${slugA}/quotes/${sentQuoteId}$`)
  );

  const restoredAudit = await admin
    .from("audit_log")
    .select("id")
    .eq("organisation_id", orgAId)
    .eq("target_id", sentQuoteId)
    .eq("action", "quote.restored");
  expect(restoredAudit.data?.length).toBe(1);
});

test("read_only sees neither control and the actions deny server-side", async ({
  page,
}) => {
  await signIn(page, "readonly-a");

  await page.goto(`/app/${slugA}/quotes/${keptQuoteId}`);
  await expect(
    page.getByRole("heading", { name: `Quote #2 Kept quote ${run}` })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete", exact: true })
  ).toHaveCount(0);

  // Seed a deleted quote so the deleted view has a row to (not) restore.
  const customer = await admin
    .from("customers")
    .insert({ organisation_id: orgAId, name: `RO Co ${run}` })
    .select("id")
    .single();
  if (customer.error) throw new Error(customer.error.message);
  const deleted = await admin
    .from("quotes")
    .insert({
      organisation_id: orgAId,
      customer_id: customer.data.id,
      quote_number: 3,
      title: `Already deleted ${run}`,
      deleted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (deleted.error) throw new Error(deleted.error.message);

  await page.goto(`/app/${slugA}/quotes/deleted`);
  await expect(page.getByText(`Already deleted ${run}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore" })).toHaveCount(0);

  // Server-side enforcement regardless of hidden buttons.
  const denyDelete = await page.request.post(`/api/quotes-harness/${slugA}`, {
    data: { action: "softDeleteQuote", input: { id: keptQuoteId } },
  });
  expect(denyDelete.status()).toBe(403);
  const denyRestore = await page.request.post(`/api/quotes-harness/${slugA}`, {
    data: { action: "restoreQuote", input: { id: deleted.data.id } },
  });
  expect(denyRestore.status()).toBe(403);

  const kept = await admin
    .from("quotes")
    .select("deleted_at")
    .eq("id", keptQuoteId)
    .single();
  expect(kept.data?.deleted_at).toBeNull();
  const stillDeleted = await admin
    .from("quotes")
    .select("deleted_at")
    .eq("id", deleted.data.id)
    .single();
  expect(stillDeleted.data?.deleted_at).not.toBeNull();
});
