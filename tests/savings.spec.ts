// Savings test for Pass 11A. Runs with: npm run test:savings
//
// Two parts in one command. First, the real savings actions through the harness
// route with real signed-in sessions per role: organisation A has the
// subscription_savings module, organisation B does not, organisation C has it
// and is used only by the totals test so its sum is deterministic. It proves
// tenant isolation, read_only reads but cannot write, staff and manager can
// write, an organisation without the subscription_savings entitlement is denied
// (403), cross-tenant actions are a calm null, the CRUD lifecycle (create, list,
// update, audited delete), and that listSavings returns the cadence-normalised
// monthly and annual totals exactly for a mix of monthly and annual items.
// Second, the pure totals helper by direct import: a mix is summed as integer
// pence with no rounding drift (rounding the aggregate once, never per item).

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { computeSavingsTotals } from "../lib/savings/totals";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `sav-a-${run}`;
const slugB = `sav-b-${run}`;
const slugC = `sav-c-${run}`;
const emailFor = (label: string) => `${label}-${run}@savings.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
const planIds: string[] = [];
let savingsBId: string;

async function makePlan(label: string, modules: string[]) {
  const plan = await admin
    .from("plans")
    .insert({ key: `sav-${label}-${run}`, name: "SAV", monthly_price_pence: 1000 })
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
    org_id: orgIds[label],
    new_plan_id: plan.data.id,
  });
  if (assigned.error) throw new Error(assigned.error.message);
}

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["b", slugB],
    ["c", slugC],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Savings ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  // A and C have subscription_savings; B does not (customers only), so B's
  // member is denied and a savings item placed in B by the admin is invisible
  // to A.
  await makePlan("a", ["subscription_savings"]);
  await makePlan("b", ["customers"]);
  await makePlan("c", ["subscription_savings"]);

  const members: Array<[string, string, string]> = [
    ["readonly-a", "a", "read_only"],
    ["staff-a", "a", "staff"],
    ["manager-a", "a", "manager"],
    ["staff-b", "b", "staff"],
    ["staff-c", "c", "staff"],
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

  // A savings item in organisation B (admin bypasses RLS and the module gate),
  // for the cross-tenant checks.
  const savingsB = await admin
    .from("savings_items")
    .insert({
      organisation_id: orgIds.b,
      label: `B saving ${run}`,
      amount_pence: 500,
      cadence: "monthly",
    })
    .select("id")
    .single();
  if (savingsB.error) throw new Error(savingsB.error.message);
  savingsBId = savingsB.data.id;
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

type ActResult = { status: number; data: unknown };

async function act(
  page: Page,
  action: string,
  input: unknown = {},
  slug = slugA
): Promise<ActResult> {
  const response = await page.request.post(`/api/savings-harness/${slug}`, {
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

type SavingsItemRow = Record<string, unknown> & { id: string };
type SavingsList = {
  items: SavingsItemRow[];
  totals: { monthlyTotalPence: number; annualTotalPence: number };
};

async function createItem(
  page: Page,
  input: Record<string, unknown>,
  slug = slugA
) {
  return (await act(page, "createSavingsItem", input, slug))
    .data as SavingsItemRow | null;
}

async function list(page: Page, slug = slugA) {
  return (await act(page, "listSavings", {}, slug)).data as SavingsList | null;
}

async function listIds(page: Page, slug = slugA) {
  return ((await list(page, slug))?.items ?? []).map((i) => i.id);
}

async function auditCount(action: string, targetId: string) {
  const { data } = await admin
    .from("audit_log")
    .select("id")
    .eq("action", action)
    .eq("target_id", targetId);
  return data?.length ?? 0;
}

test("read_only reads savings but cannot write them", async ({ page }) => {
  await signIn(page, "readonly-a");

  expect((await act(page, "listSavings", {})).status).toBe(200);

  expect(
    (
      await act(page, "createSavingsItem", {
        label: "RO",
        amount_pence: 100,
        cadence: "monthly",
      })
    ).status
  ).toBe(403);
  const id = crypto.randomUUID();
  expect(
    (await act(page, "updateSavingsItem", { id, label: "RO" })).status
  ).toBe(403);
  expect((await act(page, "deleteSavingsItem", { id })).status).toBe(403);
});

test("staff and manager can write savings", async ({ page }) => {
  await signIn(page, "manager-a");
  const byManager = await createItem(page, {
    label: `Manager saving ${run}`,
    amount_pence: 1200,
    cadence: "monthly",
  });
  expect(byManager?.id).toBeTruthy();

  await signIn(page, "staff-a");
  const byStaff = await createItem(page, {
    label: `Staff saving ${run}`,
    amount_pence: 3400,
    cadence: "annual",
  });
  expect(byStaff?.id).toBeTruthy();
});

test("an organisation without the subscription_savings entitlement is denied", async ({
  page,
}) => {
  await signIn(page, "staff-b");
  expect((await act(page, "listSavings", {}, slugB)).status).toBe(403);
  expect(
    (
      await act(
        page,
        "createSavingsItem",
        { label: "B", amount_pence: 100, cadence: "monthly" },
        slugB
      )
    ).status
  ).toBe(403);
});

test("cross-tenant savings actions are rejected", async ({ page }) => {
  await signIn(page, "staff-a");
  // Savings item B belongs to organisation B; staff-a is scoped to A.
  expect(
    (await act(page, "updateSavingsItem", { id: savingsBId, label: "X" })).data
  ).toBeNull();
  expect(
    (await act(page, "deleteSavingsItem", { id: savingsBId })).data
  ).toBeNull();
  expect(await listIds(page)).not.toContain(savingsBId);
  // The delete touched nothing: B's item still exists (admin re-read).
  const survives = await admin
    .from("savings_items")
    .select("id")
    .eq("id", savingsBId)
    .maybeSingle();
  expect(survives.data?.id).toBe(savingsBId);
});

test("full lifecycle: create, list, update, audited delete", async ({ page }) => {
  await signIn(page, "staff-a");

  const keep = await createItem(page, {
    label: `Keep ${run}`,
    amount_pence: 999,
    cadence: "monthly",
    note: "Cancelled the old CRM",
    cancelled_on: "2026-05-01",
  });
  const drop = await createItem(page, {
    label: `Drop ${run}`,
    amount_pence: 4500,
    cadence: "annual",
  });
  expect(keep?.id).toBeTruthy();
  expect(drop?.id).toBeTruthy();
  expect(keep?.amount_pence).toBe(999);
  expect(keep?.cadence).toBe("monthly");
  expect(keep?.note).toBe("Cancelled the old CRM");
  expect(keep?.cancelled_on).toBe("2026-05-01");
  // Cadence defaults to monthly when omitted.
  const defaulted = await createItem(page, {
    label: `Default cadence ${run}`,
    amount_pence: 200,
  });
  expect(defaulted?.cadence).toBe("monthly");

  // Both appear in the list.
  const ids = await listIds(page);
  expect(ids).toContain(keep!.id);
  expect(ids).toContain(drop!.id);

  // Update changes the provided fields only; an explicit blank clears note.
  const updated = (
    await act(page, "updateSavingsItem", {
      id: keep!.id,
      label: `Keep edited ${run}`,
      amount_pence: 1099,
      cadence: "annual",
      note: "",
    })
  ).data as SavingsItemRow;
  expect(updated.label).toBe(`Keep edited ${run}`);
  expect(updated.amount_pence).toBe(1099);
  expect(updated.cadence).toBe("annual");
  expect(updated.note).toBeNull();
  // cancelled_on was not provided, so it is unchanged.
  expect(updated.cancelled_on).toBe("2026-05-01");

  // Delete is a permanent hard delete, audited, and gone from the list.
  const del = (await act(page, "deleteSavingsItem", { id: drop!.id })).data as {
    id: string;
  };
  expect(del.id).toBe(drop!.id);
  expect(await auditCount("savings_item.deleted", drop!.id)).toBe(1);
  expect(await listIds(page)).not.toContain(drop!.id);
});

test("listSavings totals a mix of monthly and annual items exactly", async ({
  page,
}) => {
  // Organisation C is touched only by this test. Clear it first (admin) so a
  // retry cannot double the sum, then build a known mix through the real
  // session and read the totals back through the action.
  await admin.from("savings_items").delete().eq("organisation_id", orgIds.c);

  await signIn(page, "staff-c");

  const mix: Array<{ amount_pence: number; cadence: "monthly" | "annual" }> = [
    { amount_pence: 1500, cadence: "monthly" }, // £15.00 / month
    { amount_pence: 500, cadence: "monthly" }, // £5.00 / month
    { amount_pence: 6000, cadence: "annual" }, // £60.00 / year
    { amount_pence: 100, cadence: "annual" }, // £1.00 / year
  ];
  for (const [index, item] of mix.entries()) {
    const created = await createItem(
      page,
      { label: `Mix ${index} ${run}`, ...item },
      slugC
    );
    expect(created?.id).toBeTruthy();
  }

  const result = await list(page, slugC);
  expect(result?.items).toHaveLength(mix.length);

  // Annual total is exact integer pence: monthly items times twelve plus annual
  // items once. 1500*12 + 500*12 + 6000 + 100 = 30100.
  // Monthly total is that annual total over twelve, rounded once:
  // round(30100 / 12) = round(2508.33...) = 2508.
  expect(result?.totals.annualTotalPence).toBe(30100);
  expect(result?.totals.monthlyTotalPence).toBe(2508);

  // The action's totals match the pure helper applied to the returned items, so
  // the two can never disagree.
  const expected = computeSavingsTotals(
    (result?.items ?? []).map((i) => ({
      amount_pence: i.amount_pence as number,
      cadence: i.cadence as "monthly" | "annual",
    }))
  );
  expect(result?.totals).toEqual(expected);
});

// --- The pure totals helper (no session needed) ---

test("the totals helper normalises cadence and rounds the aggregate once", () => {
  // Empty list totals nothing.
  expect(computeSavingsTotals([])).toEqual({
    monthlyTotalPence: 0,
    annualTotalPence: 0,
  });

  // A monthly item round-trips exactly (annual is twelve months, monthly is
  // back to itself).
  expect(computeSavingsTotals([{ amount_pence: 1000, cadence: "monthly" }])).toEqual({
    annualTotalPence: 12000,
    monthlyTotalPence: 1000,
  });

  // An annual item's monthly figure is necessarily rounded: round(100/12) = 8.
  expect(computeSavingsTotals([{ amount_pence: 100, cadence: "annual" }])).toEqual({
    annualTotalPence: 100,
    monthlyTotalPence: 8,
  });

  // No rounding drift: three annual items of 100p total 300p a year and 25p a
  // month (round(300/12) = 25), NOT 3 x round(100/12) = 24. The aggregate is
  // rounded once, never each item.
  expect(
    computeSavingsTotals([
      { amount_pence: 100, cadence: "annual" },
      { amount_pence: 100, cadence: "annual" },
      { amount_pence: 100, cadence: "annual" },
    ])
  ).toEqual({ annualTotalPence: 300, monthlyTotalPence: 25 });

  // The same mix the session test uses, proven from pence here too.
  expect(
    computeSavingsTotals([
      { amount_pence: 1500, cadence: "monthly" },
      { amount_pence: 500, cadence: "monthly" },
      { amount_pence: 6000, cadence: "annual" },
      { amount_pence: 100, cadence: "annual" },
    ])
  ).toEqual({ annualTotalPence: 30100, monthlyTotalPence: 2508 });
});
