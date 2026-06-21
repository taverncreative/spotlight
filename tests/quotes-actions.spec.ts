// Quotes server action test for Pass 3B. Runs with:
// npm run test:quotes-actions
//
// Exercises the real server actions through the harness route with real
// signed-in sessions per role. Organisations A and B have the quotes module
// via a real assign_plan call; organisation N has no entitlements. Proves
// the role gates, the entitlement gate, cross-tenant denial, atomic quote
// numbering including two concurrent creates, the cross-tenant customer
// rejection, the lifecycle with customer name in the list, and the audit
// rows for soft delete and restore.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `qa-a-${run}`;
const slugB = `qa-b-${run}`;
const slugN = `qa-n-${run}`;
const emailFor = (label: string) => `${label}-${run}@quotes-actions.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
let planId: string;
let custAId: string;
let custBId: string;
let quoteBId: string;

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["b", slugB],
    ["n", slugN],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Quotes Actions ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  const plan = await admin
    .from("plans")
    .insert({ key: `qa-${run}`, name: "QA", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planId = plan.data.id;
  const linked = await admin
    .from("plan_modules")
    .insert({ plan_id: planId, module: "quotes" });
  if (linked.error) throw new Error(linked.error.message);
  for (const label of ["a", "b"]) {
    const assigned = await admin.rpc("assign_plan", {
      org_id: orgIds[label],
      new_plan_id: planId,
    });
    if (assigned.error) throw new Error(assigned.error.message);
  }
  // Organisation N deliberately gets no plan and no entitlements.

  const members: Array<[string, string, string]> = [
    ["readonly-a", "a", "read_only"],
    ["staff-a", "a", "staff"],
    ["admin-n", "n", "client_admin"],
  ];
  for (const [label, orgLabel, role] of members) {
    const user = await admin.auth.admin.createUser({
      email: emailFor(label),
      password,
      email_confirm: true,
    });
    if (user.error || !user.data.user) throw new Error(user.error?.message);
    userIds.push(user.data.user.id);
    const membership = await admin.from("organisation_memberships").insert({
      organisation_id: orgIds[orgLabel],
      user_id: user.data.user.id,
      role,
      status: "active",
    });
    if (membership.error) throw new Error(membership.error.message);
  }

  const custA = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.a, name: `Quoted Co ${run}` })
    .select("id")
    .single();
  if (custA.error) throw new Error(custA.error.message);
  custAId = custA.data.id;
  const custB = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.b, name: `Other Org Co ${run}` })
    .select("id")
    .single();
  if (custB.error) throw new Error(custB.error.message);
  custBId = custB.data.id;

  const quoteB = await admin
    .from("quotes")
    .insert({
      organisation_id: orgIds.b,
      customer_id: custBId,
      quote_number: 9001,
      title: "Org B quote",
    })
    .select("id")
    .single();
  if (quoteB.error) throw new Error(quoteB.error.message);
  quoteBId = quoteB.data.id;
});

test.afterAll(async () => {
  const ids = Object.values(orgIds);
  await admin.from("audit_log").delete().in("organisation_id", ids);
  // Quotes restrict customer deletion, so remove them before the cascade.
  await admin.from("quotes").delete().in("organisation_id", ids);
  await admin.from("organisations").delete().in("id", ids);
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

async function act(
  page: Page,
  action: string,
  input: unknown = {},
  slug = slugA
) {
  const response = await page.request.post(`/api/quotes-harness/${slug}`, {
    data: { action, input },
  });
  let data: unknown = null;
  try {
    data = ((await response.json()) as { data?: unknown }).data ?? null;
  } catch {
    // non-JSON responses (404 pages) leave data null
  }
  return { status: response.status(), data };
}

test("read_only: reads allowed, every write denied", async ({ page }) => {
  await signIn(page, "readonly-a");
  expect((await act(page, "listQuotes")).status).toBe(200);
  expect(
    (await act(page, "getQuote", { id: crypto.randomUUID() })).status
  ).toBe(200);
  expect(
    (await act(page, "createQuote", { customer_id: custAId })).status
  ).toBe(403);
  expect(
    (await act(page, "updateQuote", { id: crypto.randomUUID(), title: "N" }))
      .status
  ).toBe(403);
  expect(
    (await act(page, "softDeleteQuote", { id: crypto.randomUUID() })).status
  ).toBe(403);
  expect(
    (await act(page, "restoreQuote", { id: crypto.randomUUID() })).status
  ).toBe(403);
});

test("staff lifecycle: numbering, list with customer, update, delete, restore, audit", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  // Two sequential creates allocate different sequential numbers.
  const first = await act(page, "createQuote", {
    customer_id: custAId,
    title: "First quote",
  });
  expect(first.status).toBe(200);
  const quote1 = first.data as { id: string; quote_number: number };
  const second = await act(page, "createQuote", {
    customer_id: custAId,
    title: "Second quote",
  });
  const quote2 = second.data as { id: string; quote_number: number };
  expect(quote2.quote_number).toBe(quote1.quote_number + 1);

  // Two concurrent creates also never share a number.
  const [c1, c2] = await Promise.all([
    act(page, "createQuote", { customer_id: custAId, title: "Race one" }),
    act(page, "createQuote", { customer_id: custAId, title: "Race two" }),
  ]);
  expect(c1.status).toBe(200);
  expect(c2.status).toBe(200);
  const n1 = (c1.data as { quote_number: number }).quote_number;
  const n2 = (c2.data as { quote_number: number }).quote_number;
  expect(n1).not.toBe(n2);

  // All numbers unique within the organisation (database check).
  const numbers = await admin
    .from("quotes")
    .select("quote_number")
    .eq("organisation_id", orgIds.a);
  const seen = (numbers.data ?? []).map((row) => row.quote_number);
  expect(new Set(seen).size).toBe(seen.length);

  // The list shows the quote with its customer's name.
  const listed = await act(page, "listQuotes");
  const listedQuote = (
    listed.data as { id: string; customers: { name: string } | null }[]
  ).find((row) => row.id === quote1.id);
  expect(listedQuote?.customers?.name).toBe(`Quoted Co ${run}`);

  // Header update (status is no longer a header field; it moves only
  // through transitionQuoteStatus).
  const updated = await act(page, "updateQuote", {
    id: quote1.id,
    title: "First quote renamed",
    valid_until: "2026-07-31",
  });
  expect(updated.status).toBe(200);
  expect((updated.data as { title: string }).title).toBe("First quote renamed");
  expect((updated.data as { valid_until: string }).valid_until).toBe(
    "2026-07-31"
  );

  // Soft delete, restore, audit.
  const deleted = await act(page, "softDeleteQuote", { id: quote1.id });
  expect((deleted.data as { id: string }).id).toBe(quote1.id);
  const afterDelete = await act(page, "listQuotes");
  expect(
    (afterDelete.data as { id: string }[]).some((row) => row.id === quote1.id)
  ).toBe(false);
  const restored = await act(page, "restoreQuote", { id: quote1.id });
  expect(restored.status).toBe(200);
  const afterRestore = await act(page, "listQuotes");
  expect(
    (afterRestore.data as { id: string }[]).some((row) => row.id === quote1.id)
  ).toBe(true);

  const audit = await admin
    .from("audit_log")
    .select("action")
    .eq("organisation_id", orgIds.a)
    .eq("target_id", quote1.id);
  expect((audit.data ?? []).map((row) => row.action).sort()).toEqual([
    "quote.restored",
    "quote.soft_deleted",
  ]);
});

test("createQuote referencing another organisation's customer is rejected", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  const before = await admin
    .from("quotes")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", orgIds.a);

  const result = await act(page, "createQuote", { customer_id: custBId });
  expect(result.status).toBe(200);
  expect(result.data).toBeNull();

  const after = await admin
    .from("quotes")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", orgIds.a);
  expect(after.count).toBe(before.count);
});

test("organisation without the quotes entitlement is denied everything", async ({
  page,
}) => {
  await signIn(page, "admin-n");
  expect((await act(page, "listQuotes", {}, slugN)).status).toBe(403);
  expect(
    (await act(page, "createQuote", { customer_id: custAId }, slugN)).status
  ).toBe(403);
  expect(
    (await act(page, "softDeleteQuote", { id: crypto.randomUUID() }, slugN))
      .status
  ).toBe(403);
});

test("member of A cannot act on B's quotes", async ({ page }) => {
  await signIn(page, "staff-a");

  expect((await act(page, "listQuotes", {}, slugB)).status).toBe(404);

  const update = await act(page, "updateQuote", {
    id: quoteBId,
    title: "Hijacked",
  });
  expect(update.status).toBe(200);
  expect(update.data).toBeNull();
  const softDelete = await act(page, "softDeleteQuote", { id: quoteBId });
  expect(softDelete.data).toBeNull();

  const untouched = await admin
    .from("quotes")
    .select("title, deleted_at")
    .eq("id", quoteBId)
    .single();
  expect(untouched.data?.title).toBe("Org B quote");
  expect(untouched.data?.deleted_at).toBeNull();
});
