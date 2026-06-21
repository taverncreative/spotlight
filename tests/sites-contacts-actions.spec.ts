// Sites and contacts server-action test for Pass 5B. Runs with:
// npm run test:sites-contacts-actions
//
// Exercises the real actions through the harness routes with real signed-in
// sessions per role. Organisations A and B have the customers module via a
// real assign_plan call; organisation N has none. Proves, for both sites and
// contacts: read_only reads but cannot write, staff and manager can write, an
// organisation without the customers entitlement is denied, and acting on
// another organisation's customer is rejected with a calm null. Plus the full
// lifecycle (create, list, update, then site soft-delete/restore and contact
// permanent delete, each audited) and the primary-contact rule.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `sca-a-${run}`;
const slugB = `sca-b-${run}`;
const slugN = `sca-n-${run}`;
const emailFor = (label: string) => `${label}-${run}@sites-contacts-actions.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
let planId: string;
let custAId: string;
let custBId: string;
let siteBId: string;

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["b", slugB],
    ["n", slugN],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Sites Contacts ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  const plan = await admin
    .from("plans")
    .insert({ key: `sca-${run}`, name: "SCA", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planId = plan.data.id;
  const linked = await admin
    .from("plan_modules")
    .insert({ plan_id: planId, module: "customers" });
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
    ["manager-a", "a", "manager"],
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
    .insert({ organisation_id: orgIds.a, name: `Customer A ${run}` })
    .select("id")
    .single();
  if (custA.error) throw new Error(custA.error.message);
  custAId = custA.data.id;
  const custB = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.b, name: `Customer B ${run}` })
    .select("id")
    .single();
  if (custB.error) throw new Error(custB.error.message);
  custBId = custB.data.id;

  // A site in organisation B, for the cross-tenant by-id checks.
  const siteB = await admin
    .from("sites")
    .insert({ organisation_id: orgIds.b, customer_id: custBId, name: "Site B" })
    .select("id")
    .single();
  if (siteB.error) throw new Error(siteB.error.message);
  siteBId = siteB.data.id;
});

test.afterAll(async () => {
  const ids = Object.values(orgIds);
  await admin.from("audit_log").delete().in("organisation_id", ids);
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
  harness: "sites" | "contacts",
  action: string,
  input: unknown = {},
  slug = slugA
) {
  const response = await page.request.post(`/api/${harness}-harness/${slug}`, {
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

async function auditCount(action: string, targetId: string) {
  const { data } = await admin
    .from("audit_log")
    .select("id")
    .eq("action", action)
    .eq("target_id", targetId);
  return data?.length ?? 0;
}

test("read_only reads but cannot write sites or contacts", async ({ page }) => {
  await signIn(page, "readonly-a");

  expect((await act(page, "sites", "listSites", { customer_id: custAId })).status).toBe(200);
  expect((await act(page, "contacts", "listContacts", { customer_id: custAId })).status).toBe(200);

  const id = crypto.randomUUID();
  expect((await act(page, "sites", "createSite", { customer_id: custAId, name: "RO" })).status).toBe(403);
  expect((await act(page, "sites", "updateSite", { id, name: "RO" })).status).toBe(403);
  expect((await act(page, "sites", "softDeleteSite", { id })).status).toBe(403);
  expect((await act(page, "sites", "restoreSite", { id })).status).toBe(403);
  expect((await act(page, "contacts", "createContact", { customer_id: custAId, name: "RO" })).status).toBe(403);
  expect((await act(page, "contacts", "updateContact", { id, name: "RO" })).status).toBe(403);
  expect((await act(page, "contacts", "deleteContact", { id })).status).toBe(403);
});

test("manager can write, and an organisation without the customers entitlement is denied", async ({
  page,
}) => {
  await signIn(page, "manager-a");
  const created = await act(page, "sites", "createSite", {
    customer_id: custAId,
    name: `Manager site ${run}`,
  });
  expect(created.status).toBe(200);
  expect((created.data as { id: string } | null)?.id).toBeTruthy();

  await signIn(page, "admin-n");
  expect((await act(page, "sites", "listSites", { customer_id: custAId }, slugN)).status).toBe(403);
  expect((await act(page, "sites", "createSite", { customer_id: custAId, name: "N" }, slugN)).status).toBe(403);
  expect((await act(page, "contacts", "listContacts", { customer_id: custAId }, slugN)).status).toBe(403);
  expect((await act(page, "contacts", "createContact", { customer_id: custAId, name: "N" }, slugN)).status).toBe(403);
});

test("acting on another organisation's customer is rejected with a calm null", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  // Customer B belongs to organisation B; staff-a is scoped to A.
  const siteList = await act(page, "sites", "listSites", { customer_id: custBId });
  expect(siteList.status).toBe(200);
  expect(siteList.data).toBeNull();

  const siteCreate = await act(page, "sites", "createSite", { customer_id: custBId, name: "X" });
  expect(siteCreate.status).toBe(200);
  expect(siteCreate.data).toBeNull();

  const contactCreate = await act(page, "contacts", "createContact", { customer_id: custBId, name: "X" });
  expect(contactCreate.status).toBe(200);
  expect(contactCreate.data).toBeNull();

  // Acting on organisation B's site by id finds nothing in A's scope.
  const siteUpdate = await act(page, "sites", "updateSite", { id: siteBId, name: "X" });
  expect(siteUpdate.status).toBe(200);
  expect(siteUpdate.data).toBeNull();
});

test("site lifecycle: create, list, update, soft-delete and restore, audited", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  const created = await act(page, "sites", "createSite", {
    customer_id: custAId,
    name: `Depot ${run}`,
    town: "Chatham",
  });
  const site = created.data as { id: string; name: string; town: string };
  expect(site.id).toBeTruthy();
  expect(site.town).toBe("Chatham");

  const listed = await act(page, "sites", "listSites", { customer_id: custAId });
  expect((listed.data as { id: string }[]).some((s) => s.id === site.id)).toBe(true);

  const updated = await act(page, "sites", "updateSite", { id: site.id, name: `Depot updated ${run}` });
  expect((updated.data as { name: string }).name).toBe(`Depot updated ${run}`);

  // Soft delete: removed from the active list, present in the deleted list, audited.
  const del = await act(page, "sites", "softDeleteSite", { id: site.id });
  expect((del.data as { id: string }).id).toBe(site.id);
  expect(await auditCount("site.soft_deleted", site.id)).toBe(1);
  const activeAfter = await act(page, "sites", "listSites", { customer_id: custAId });
  expect((activeAfter.data as { id: string }[]).some((s) => s.id === site.id)).toBe(false);
  const deletedAfter = await act(page, "sites", "listDeletedSites", { customer_id: custAId });
  expect((deletedAfter.data as { id: string }[]).some((s) => s.id === site.id)).toBe(true);

  // Restore: back in the active list, audited.
  const restored = await act(page, "sites", "restoreSite", { id: site.id });
  expect((restored.data as { id: string }).id).toBe(site.id);
  expect(await auditCount("site.restored", site.id)).toBe(1);
  const activeRestored = await act(page, "sites", "listSites", { customer_id: custAId });
  expect((activeRestored.data as { id: string }[]).some((s) => s.id === site.id)).toBe(true);
});

test("contact lifecycle: create, update, permanent delete, audited", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  const created = await act(page, "contacts", "createContact", {
    customer_id: custAId,
    name: `Jo Contact ${run}`,
    email: `jo-${run}@example.com`,
  });
  const contact = created.data as { id: string; email: string };
  expect(contact.id).toBeTruthy();
  expect(contact.email).toBe(`jo-${run}@example.com`);

  const updated = await act(page, "contacts", "updateContact", {
    id: contact.id,
    job_title: "Site Manager",
  });
  expect((updated.data as { job_title: string }).job_title).toBe("Site Manager");

  // Permanent delete, audited, and genuinely gone (service-role re-read).
  const del = await act(page, "contacts", "deleteContact", { id: contact.id });
  expect((del.data as { id: string }).id).toBe(contact.id);
  expect(await auditCount("contact.deleted", contact.id)).toBe(1);
  const { data: gone } = await admin
    .from("contacts")
    .select("id")
    .eq("id", contact.id);
  expect(gone?.length).toBe(0);
});

test("primary contact: setting one primary unsets the others", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  // A dedicated customer so the count of primaries is unambiguous.
  const cust = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.a, name: `Primary cust ${run}` })
    .select("id")
    .single();
  const custId = cust.data!.id as string;

  const first = (
    await act(page, "contacts", "createContact", {
      customer_id: custId,
      name: "First",
      is_primary: true,
    })
  ).data as { id: string };
  const second = (
    await act(page, "contacts", "createContact", {
      customer_id: custId,
      name: "Second",
      is_primary: true,
    })
  ).data as { id: string };

  // Creating Second as primary demoted First.
  const afterCreate = await admin
    .from("contacts")
    .select("id, is_primary")
    .eq("customer_id", custId);
  const primaries1 = afterCreate.data!.filter((c) => c.is_primary);
  expect(primaries1.length).toBe(1);
  expect(primaries1[0].id).toBe(second.id);

  // Promoting First back demotes Second.
  await act(page, "contacts", "updateContact", { id: first.id, is_primary: true });
  const afterUpdate = await admin
    .from("contacts")
    .select("id, is_primary")
    .eq("customer_id", custId);
  const primaries2 = afterUpdate.data!.filter((c) => c.is_primary);
  expect(primaries2.length).toBe(1);
  expect(primaries2[0].id).toBe(first.id);
});
