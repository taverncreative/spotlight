// Lead-to-customer conversion test for Pass 2F. Runs with:
// npm run test:lead-convert
//
// Organisations A and B have both modules via a real assign_plan call;
// organisation L has leads only. Proves the atomic conversion through the
// real dialog, the calm already-converted path, the audit row, the courtesy
// hiding plus server-side denial for read_only and for the
// missing-customers-module organisation, cross-tenant denial, and that a
// direct function call by read_only creates nothing (invoker RLS rollback).

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `lc-a-${run}`;
const slugB = `lc-b-${run}`;
const slugL = `lc-l-${run}`;
const emailFor = (label: string) => `${label}-${run}@lead-convert.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
const planIds: string[] = [];
let leadAId: string;
let leadA2Id: string;
let leadBId: string;
let leadLId: string;

async function makePlan(key: string, modules: string[]) {
  const plan = await admin
    .from("plans")
    .insert({ key, name: key, monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planIds.push(plan.data.id);
  const linked = await admin
    .from("plan_modules")
    .insert(modules.map((module) => ({ plan_id: plan.data.id, module })));
  if (linked.error) throw new Error(linked.error.message);
  return plan.data.id;
}

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["b", slugB],
    ["l", slugL],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Convert ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  const bothPlan = await makePlan(`lc-both-${run}`, ["leads", "customers"]);
  const leadsOnlyPlan = await makePlan(`lc-leads-${run}`, ["leads"]);
  for (const [label, planId] of [
    ["a", bothPlan],
    ["b", bothPlan],
    ["l", leadsOnlyPlan],
  ] as const) {
    const assigned = await admin.rpc("assign_plan", {
      org_id: orgIds[label],
      new_plan_id: planId,
    });
    if (assigned.error) throw new Error(assigned.error.message);
  }

  const members: Array<[string, string, string]> = [
    ["staff-a", "a", "staff"],
    ["readonly-a", "a", "read_only"],
    ["staff-l", "l", "staff"],
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

  const seed = async (orgLabel: string, name: string) => {
    const lead = await admin
      .from("leads")
      .insert({
        organisation_id: orgIds[orgLabel],
        name,
        email: "convert.me@example.co.uk",
        phone: "07700 900777",
      })
      .select("id")
      .single();
    if (lead.error) throw new Error(lead.error.message);
    return lead.data.id as string;
  };
  leadAId = await seed("a", `Convert me ${run}`);
  leadA2Id = await seed("a", `Untouched ${run}`);
  leadBId = await seed("b", `Org B lead ${run}`);
  leadLId = await seed("l", `Org L lead ${run}`);
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
  await expect(page).toHaveURL(/\/app\//);
}

async function convertViaHarness(page: Page, leadId: string, slug = slugA) {
  const response = await page.request.post(`/api/leads-harness/${slug}`, {
    data: { action: "convertLeadToCustomer", input: { id: leadId } },
  });
  let data: unknown = null;
  try {
    data = ((await response.json()) as { data?: unknown }).data ?? null;
  } catch {
    // non-JSON responses leave data null
  }
  return { status: response.status(), data };
}

test("staff converts a lead atomically through the dialog", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  await page.goto(`/app/${slugA}/leads/${leadAId}`);

  await page.getByRole("button", { name: "Convert to customer" }).click();
  await expect(
    page.getByRole("alertdialog").getByText("marks the lead as converted")
  ).toBeVisible();
  await page.getByRole("button", { name: "Convert lead" }).click();

  // Lands on the new customer carrying the lead's details.
  await expect(page).toHaveURL(
    new RegExp(`/app/${slugA}/customers/[0-9a-f-]{36}$`)
  );
  await expect(
    page.getByRole("heading", { name: `Convert me ${run}` })
  ).toBeVisible();
  await expect(page.getByText("convert.me@example.co.uk")).toBeVisible();
  await expect(page.getByText("07700 900777")).toBeVisible();

  // Both sides of the atomic change are present together (service role).
  const lead = await admin
    .from("leads")
    .select("status, converted_customer_id")
    .eq("id", leadAId)
    .single();
  expect(lead.data?.status).toBe("converted");
  expect(lead.data?.converted_customer_id).not.toBeNull();
  const customer = await admin
    .from("customers")
    .select("name, email, phone, organisation_id")
    .eq("id", lead.data!.converted_customer_id!)
    .single();
  expect(customer.data?.name).toBe(`Convert me ${run}`);
  expect(customer.data?.email).toBe("convert.me@example.co.uk");
  expect(customer.data?.phone).toBe("07700 900777");
  expect(customer.data?.organisation_id).toBe(orgIds.a);

  // The audit row names the lead and the customer.
  const audit = await admin
    .from("audit_log")
    .select("metadata")
    .eq("organisation_id", orgIds.a)
    .eq("target_id", leadAId)
    .eq("action", "lead.converted");
  expect(audit.data?.length).toBe(1);
  expect(
    (audit.data![0].metadata as { customer_id?: string }).customer_id
  ).toBe(lead.data?.converted_customer_id);

  // The lead detail now shows the converted-to link, not the control.
  await page.goto(`/app/${slugA}/leads/${leadAId}`);
  await expect(page.getByText("Converted to")).toBeVisible();
  await expect(
    page.getByRole("link", { name: `Convert me ${run}`, exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Convert to customer" })
  ).toHaveCount(0);

  // Converting again reports the calm message and changes nothing.
  const again = await convertViaHarness(page, leadAId);
  expect(again.status).toBe(200);
  expect((again.data as { alreadyConverted?: boolean }).alreadyConverted).toBe(
    true
  );
  const customerCount = await admin
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", orgIds.a);
  expect(customerCount.count).toBe(1);
});

test("read_only: no control, denied server-side, direct call creates nothing", async ({
  page,
}) => {
  await signIn(page, "readonly-a");

  await page.goto(`/app/${slugA}/leads/${leadA2Id}`);
  await expect(
    page.getByRole("heading", { name: `Untouched ${run}` })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Convert to customer" })
  ).toHaveCount(0);

  expect((await convertViaHarness(page, leadA2Id)).status).toBe(403);

  // Calling the database function directly as read_only: the invoker RLS
  // stops it and the transaction creates nothing.
  const direct = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signInDirect = await direct.auth.signInWithPassword({
    email: emailFor("readonly-a"),
    password,
  });
  expect(signInDirect.error).toBeNull();
  const rpc = await direct.rpc("convert_lead_to_customer", {
    lead_id: leadA2Id,
  });
  expect(rpc.error).not.toBeNull();

  const lead = await admin
    .from("leads")
    .select("status, converted_customer_id")
    .eq("id", leadA2Id)
    .single();
  expect(lead.data?.status).toBe("new");
  expect(lead.data?.converted_customer_id).toBeNull();
  const customers = await admin
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", orgIds.a)
    .eq("name", `Untouched ${run}`);
  expect(customers.count).toBe(0);
});

test("organisation without the customers module cannot convert", async ({
  page,
}) => {
  await signIn(page, "staff-l");

  await page.goto(`/app/${slugL}/leads/${leadLId}`);
  await expect(
    page.getByRole("heading", { name: `Org L lead ${run}` })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Convert to customer" })
  ).toHaveCount(0);

  expect((await convertViaHarness(page, leadLId, slugL)).status).toBe(403);
  const lead = await admin
    .from("leads")
    .select("status")
    .eq("id", leadLId)
    .single();
  expect(lead.data?.status).toBe("new");
});

test("member of A cannot convert B's lead", async ({ page }) => {
  await signIn(page, "staff-a");

  const result = await convertViaHarness(page, leadBId);
  expect(result.status).toBe(200);
  expect(result.data).toBeNull();

  const lead = await admin
    .from("leads")
    .select("status, converted_customer_id")
    .eq("id", leadBId)
    .single();
  expect(lead.data?.status).toBe("new");
  expect(lead.data?.converted_customer_id).toBeNull();
  const customers = await admin
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", orgIds.b);
  expect(customers.count).toBe(0);
});
