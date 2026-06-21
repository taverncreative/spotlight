// Quote line-item action test for Pass 3C. Runs with:
// npm run test:quote-lines
//
// Exercises the line-item actions through the harness with real signed-in
// sessions. The totals journey is observed entirely through the actions
// (addLineItem, updateLineItem, removeLineItem, getQuote), never direct
// SQL, proving the database keeps the money correct on the real path.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `ql-a-${run}`;
const slugB = `ql-b-${run}`;
const slugN = `ql-n-${run}`;
const emailFor = (label: string) => `${label}-${run}@quote-lines.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
let planId: string;
let quoteAId: string;
let quoteBId: string;
let lineBId: string;

type Totals = {
  subtotal_pence: number;
  vat_pence: number;
  total_pence: number;
  quote_line_items: {
    id: string;
    position: number;
    description: string;
    line_total_pence: number;
  }[];
};

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["b", slugB],
    ["n", slugN],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Quote Lines ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  const plan = await admin
    .from("plans")
    .insert({ key: `ql-${run}`, name: "QL", monthly_price_pence: 1000 })
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

  const seedQuote = async (orgLabel: "a" | "b") => {
    const customer = await admin
      .from("customers")
      .insert({ organisation_id: orgIds[orgLabel], name: `Cust ${orgLabel}` })
      .select("id")
      .single();
    if (customer.error) throw new Error(customer.error.message);
    const quote = await admin
      .from("quotes")
      .insert({
        organisation_id: orgIds[orgLabel],
        customer_id: customer.data.id,
        quote_number: 1,
        title: `Quote ${orgLabel}`,
      })
      .select("id")
      .single();
    if (quote.error) throw new Error(quote.error.message);
    return quote.data.id as string;
  };
  quoteAId = await seedQuote("a");
  quoteBId = await seedQuote("b");

  const lineB = await admin
    .from("quote_line_items")
    .insert({
      organisation_id: orgIds.b,
      quote_id: quoteBId,
      position: 1,
      description: "Org B line",
      quantity: 1,
      unit_price_pence: 1000,
    })
    .select("id")
    .single();
  if (lineB.error) throw new Error(lineB.error.message);
  lineBId = lineB.data.id;
});

test.afterAll(async () => {
  const ids = Object.values(orgIds);
  await admin.from("audit_log").delete().in("organisation_id", ids);
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
    // non-JSON responses leave data null
  }
  return { status: response.status(), data };
}

async function totalsVia(page: Page) {
  const result = await act(page, "getQuote", { id: quoteAId });
  return result.data as Totals;
}

test("read_only is denied add, update and remove", async ({ page }) => {
  await signIn(page, "readonly-a");
  expect(
    (
      await act(page, "addLineItem", {
        quote_id: quoteAId,
        description: "No",
        unit_price_pence: 100,
      })
    ).status
  ).toBe(403);
  expect(
    (await act(page, "updateLineItem", { id: crypto.randomUUID() })).status
  ).toBe(403);
  expect(
    (await act(page, "removeLineItem", { id: crypto.randomUUID() })).status
  ).toBe(403);
});

test("staff: totals stay correct through add, edit and remove", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  // Empty quote: all zeros.
  let quote = await totalsVia(page);
  expect(quote.subtotal_pence).toBe(0);
  expect(quote.vat_pence).toBe(0);
  expect(quote.total_pence).toBe(0);
  expect(quote.quote_line_items).toEqual([]);

  // Line 1: 2 x 1999 at 20% -> net 3998, VAT 800.
  const l1 = await act(page, "addLineItem", {
    quote_id: quoteAId,
    description: "Crane hire",
    quantity: 2,
    unit_price_pence: 1999,
    vat_rate: 20,
  });
  expect(l1.status).toBe(200);
  const line1 = l1.data as { id: string; line_total_pence: number };
  expect(line1.line_total_pence).toBe(3998);
  quote = await totalsVia(page);
  expect(quote.subtotal_pence).toBe(3998);
  expect(quote.vat_pence).toBe(800);
  expect(quote.total_pence).toBe(4798);

  // Line 2: 1.5 x 333 at 5% -> net 500, VAT 25. Mixed rates.
  const l2 = await act(page, "addLineItem", {
    quote_id: quoteAId,
    description: "Reduced-rate item",
    quantity: 1.5,
    unit_price_pence: 333,
    vat_rate: 5,
  });
  const line2 = l2.data as { id: string; line_total_pence: number };
  expect(line2.line_total_pence).toBe(500);

  // Line 3: 1 x 10000 at 0% -> net 10000, VAT 0. Three rates mixed.
  const l3 = await act(page, "addLineItem", {
    quote_id: quoteAId,
    description: "Zero-rated item",
    quantity: 1,
    unit_price_pence: 10000,
    vat_rate: 0,
  });
  expect(l3.status).toBe(200);
  quote = await totalsVia(page);
  expect(quote.subtotal_pence).toBe(14498);
  expect(quote.vat_pence).toBe(825);
  expect(quote.total_pence).toBe(15323);
  expect(quote.quote_line_items.map((l) => l.position)).toEqual([1, 2, 3]);

  // Quantity change: line 1 -> 3 x 1999 = 5997, VAT 1199.
  await act(page, "updateLineItem", { id: line1.id, quantity: 3 });
  quote = await totalsVia(page);
  expect(quote.subtotal_pence).toBe(16497);
  expect(quote.vat_pence).toBe(1224);
  expect(quote.total_pence).toBe(17721);

  // Price change: line 2 -> 1.5 x 1000 = 1500, VAT 75.
  await act(page, "updateLineItem", { id: line2.id, unit_price_pence: 1000 });
  quote = await totalsVia(page);
  expect(quote.subtotal_pence).toBe(17497);
  expect(quote.vat_pence).toBe(1274);
  expect(quote.total_pence).toBe(18771);

  // VAT rate change: line 3 -> 20% on 10000 = 2000.
  const l3id = (l3.data as { id: string }).id;
  await act(page, "updateLineItem", { id: l3id, vat_rate: 20 });
  quote = await totalsVia(page);
  expect(quote.subtotal_pence).toBe(17497);
  expect(quote.vat_pence).toBe(3274);
  expect(quote.total_pence).toBe(20771);

  // Remove line 2.
  const removed = await act(page, "removeLineItem", { id: line2.id });
  expect((removed.data as { id: string }).id).toBe(line2.id);
  quote = await totalsVia(page);
  expect(quote.subtotal_pence).toBe(15997);
  expect(quote.vat_pence).toBe(3199);
  expect(quote.total_pence).toBe(19196);

  // Lines come back in position order after the removal.
  expect(quote.quote_line_items.map((l) => l.position)).toEqual([1, 3]);
});

test("organisation without the quotes entitlement is denied", async ({
  page,
}) => {
  await signIn(page, "admin-n");
  expect(
    (
      await act(
        page,
        "addLineItem",
        { quote_id: quoteAId, description: "No", unit_price_pence: 1 },
        slugN
      )
    ).status
  ).toBe(403);
  expect(
    (await act(page, "updateLineItem", { id: crypto.randomUUID() }, slugN))
      .status
  ).toBe(403);
  expect(
    (await act(page, "removeLineItem", { id: crypto.randomUUID() }, slugN))
      .status
  ).toBe(403);
});

test("lines under a soft-deleted quote refuse edits", async ({ page }) => {
  await signIn(page, "staff-a");

  // Seed a binned quote with a line in organisation A.
  const customer = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.a, name: "Binned quote customer" })
    .select("id")
    .single();
  if (customer.error) throw new Error(customer.error.message);
  const binned = await admin
    .from("quotes")
    .insert({
      organisation_id: orgIds.a,
      customer_id: customer.data.id,
      quote_number: 99,
      deleted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (binned.error) throw new Error(binned.error.message);
  const line = await admin
    .from("quote_line_items")
    .insert({
      organisation_id: orgIds.a,
      quote_id: binned.data.id,
      position: 1,
      description: "Binned line",
      quantity: 1,
      unit_price_pence: 1000,
    })
    .select("id")
    .single();
  if (line.error) throw new Error(line.error.message);

  const add = await act(page, "addLineItem", {
    quote_id: binned.data.id,
    description: "No",
    unit_price_pence: 100,
  });
  expect(add.data).toBeNull();
  const update = await act(page, "updateLineItem", {
    id: line.data.id,
    description: "Changed",
  });
  expect(update.data).toBeNull();
  const remove = await act(page, "removeLineItem", { id: line.data.id });
  expect(remove.data).toBeNull();

  const untouched = await admin
    .from("quote_line_items")
    .select("description")
    .eq("id", line.data.id)
    .single();
  expect(untouched.data?.description).toBe("Binned line");
});

test("cross-tenant line actions touch nothing", async ({ page }) => {
  await signIn(page, "staff-a");

  // Adding to another organisation's quote returns null and creates nothing.
  const add = await act(page, "addLineItem", {
    quote_id: quoteBId,
    description: "Hijack",
    unit_price_pence: 100,
  });
  expect(add.status).toBe(200);
  expect(add.data).toBeNull();

  // Updating and removing another organisation's line return null.
  const update = await act(page, "updateLineItem", {
    id: lineBId,
    description: "Hijacked",
  });
  expect(update.data).toBeNull();
  const remove = await act(page, "removeLineItem", { id: lineBId });
  expect(remove.data).toBeNull();

  const untouched = await admin
    .from("quote_line_items")
    .select("description")
    .eq("quote_id", quoteBId);
  expect(untouched.data?.length).toBe(1);
  expect(untouched.data![0].description).toBe("Org B line");
});
