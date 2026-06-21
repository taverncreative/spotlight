// Notes server-action test for Pass 7A. Runs with:
// npm run test:notes-actions
//
// Exercises the real notes actions through the harness route with real signed-in
// sessions per role. Organisation A has the customers, leads and quotes modules;
// organisation B has customers only (so it can note a customer but not a lead or
// quote, proving the gate follows the related record's module). Proves:
// read_only reads but cannot write, staff and manager can write, the per-record
// module gate, cross-tenant actions are a calm null, the polymorphic-link
// integrity check (non-existent, cross-organisation and soft-deleted records
// rejected, a valid one of each type accepted), and the full lifecycle (create,
// list newest-first, update the body, delete with an audit row).

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `na-a-${run}`;
const slugB = `na-b-${run}`;
const emailFor = (label: string) => `${label}-${run}@notes-actions.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
const planIds: string[] = [];
let custAId: string;
let custADeletedId: string;
let leadAId: string;
let siteAId: string;
let quoteAId: string;
let custLifecycleId: string;
let custBId: string;
let noteBId: string;

async function makePlan(label: string, modules: string[]) {
  const plan = await admin
    .from("plans")
    .insert({ key: `na-${label}-${run}`, name: "NA", monthly_price_pence: 1000 })
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
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Notes Actions ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  // A can note customers, leads, sites (via customers) and quotes; B only
  // customers, so a lead or quote note in B must be denied.
  await makePlan("a", ["customers", "leads", "quotes"]);
  await makePlan("b", ["customers"]);

  const members: Array<[string, string, string]> = [
    ["readonly-a", "a", "read_only"],
    ["staff-a", "a", "staff"],
    ["manager-a", "a", "manager"],
    ["staff-b", "b", "staff"],
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

  // Records in organisation A: one live of each type, a soft-deleted customer,
  // and a dedicated customer the lifecycle test uses alone.
  const custA = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.a, name: `Customer A ${run}` })
    .select("id")
    .single();
  if (custA.error) throw new Error(custA.error.message);
  custAId = custA.data.id;

  const custLifecycle = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.a, name: `Lifecycle customer ${run}` })
    .select("id")
    .single();
  if (custLifecycle.error) throw new Error(custLifecycle.error.message);
  custLifecycleId = custLifecycle.data.id;

  const custADeleted = await admin
    .from("customers")
    .insert({
      organisation_id: orgIds.a,
      name: `Deleted customer A ${run}`,
      deleted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (custADeleted.error) throw new Error(custADeleted.error.message);
  custADeletedId = custADeleted.data.id;

  const leadA = await admin
    .from("leads")
    .insert({ organisation_id: orgIds.a, name: `Lead A ${run}` })
    .select("id")
    .single();
  if (leadA.error) throw new Error(leadA.error.message);
  leadAId = leadA.data.id;

  const siteA = await admin
    .from("sites")
    .insert({ organisation_id: orgIds.a, customer_id: custAId, name: `Site A ${run}` })
    .select("id")
    .single();
  if (siteA.error) throw new Error(siteA.error.message);
  siteAId = siteA.data.id;

  const quoteA = await admin
    .from("quotes")
    .insert({ organisation_id: orgIds.a, customer_id: custAId, quote_number: 9101 })
    .select("id")
    .single();
  if (quoteA.error) throw new Error(quoteA.error.message);
  quoteAId = quoteA.data.id;

  const custB = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.b, name: `Customer B ${run}` })
    .select("id")
    .single();
  if (custB.error) throw new Error(custB.error.message);
  custBId = custB.data.id;

  // A note in organisation B, for the cross-tenant by-id checks.
  const noteB = await admin
    .from("notes")
    .insert({
      organisation_id: orgIds.b,
      body: `Note B ${run}`,
      related_type: "customer",
      related_id: custBId,
    })
    .select("id")
    .single();
  if (noteB.error) throw new Error(noteB.error.message);
  noteBId = noteB.data.id;
});

test.afterAll(async () => {
  const ids = Object.values(orgIds);
  await admin.from("audit_log").delete().in("organisation_id", ids);
  // Quotes restrict customer deletion, so clear them before the org cascade.
  await admin.from("quotes").delete().in("organisation_id", ids);
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

type ActResult = { status: number; data: unknown };

async function act(
  page: Page,
  action: string,
  input: unknown = {},
  slug = slugA
): Promise<ActResult> {
  const response = await page.request.post(`/api/notes-harness/${slug}`, {
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

async function createNote(
  page: Page,
  input: Record<string, unknown>,
  slug = slugA
) {
  return (await act(page, "createNote", input, slug)).data as
    | (Record<string, unknown> & { id: string })
    | null;
}

async function listIds(page: Page, input: Record<string, unknown>, slug = slugA) {
  const { data } = await act(page, "listNotes", input, slug);
  return ((data as { id: string }[]) ?? []).map((n) => n.id);
}

async function auditCount(action: string, targetId: string) {
  const { data } = await admin
    .from("audit_log")
    .select("id")
    .eq("action", action)
    .eq("target_id", targetId);
  return data?.length ?? 0;
}

test("read_only reads notes but cannot write them", async ({ page }) => {
  await signIn(page, "readonly-a");

  expect(
    (await act(page, "listNotes", { related_type: "customer", related_id: custAId }))
      .status
  ).toBe(200);

  const id = crypto.randomUUID();
  expect(
    (await act(page, "createNote", {
      related_type: "customer",
      related_id: custAId,
      body: "RO",
    })).status
  ).toBe(403);
  expect((await act(page, "updateNote", { id, body: "RO" })).status).toBe(403);
  expect((await act(page, "deleteNote", { id })).status).toBe(403);
});

test("staff and manager can write notes", async ({ page }) => {
  await signIn(page, "manager-a");
  const byManager = await createNote(page, {
    related_type: "customer",
    related_id: custAId,
    body: `Manager note ${run}`,
  });
  expect(byManager?.id).toBeTruthy();

  await signIn(page, "staff-a");
  const byStaff = await createNote(page, {
    related_type: "customer",
    related_id: custAId,
    body: `Staff note ${run}`,
  });
  expect(byStaff?.id).toBeTruthy();
});

test("a note is gated by the related record's module", async ({ page }) => {
  // Organisation B has customers but not leads or quotes.
  await signIn(page, "staff-b");

  // A customer note is allowed (customers enabled, the customer exists).
  const ok = await createNote(page, {
    related_type: "customer",
    related_id: custBId,
    body: `B customer note ${run}`,
  }, slugB);
  expect(ok?.id).toBeTruthy();

  // A lead or quote note is denied: those modules are not enabled in B. The
  // gate fires on the type alone, before any record lookup.
  expect(
    (await act(page, "createNote", {
      related_type: "lead",
      related_id: crypto.randomUUID(),
      body: "x",
    }, slugB)).status
  ).toBe(403);
  expect(
    (await act(page, "createNote", {
      related_type: "quote",
      related_id: crypto.randomUUID(),
      body: "x",
    }, slugB)).status
  ).toBe(403);
  expect(
    (await act(page, "listNotes", {
      related_type: "lead",
      related_id: crypto.randomUUID(),
    }, slugB)).status
  ).toBe(403);

  // In organisation A those same types are allowed (modules enabled).
  await signIn(page, "staff-a");
  expect(
    (await act(page, "listNotes", { related_type: "quote", related_id: quoteAId }))
      .status
  ).toBe(200);
});

test("cross-tenant note actions are rejected", async ({ page }) => {
  await signIn(page, "staff-a");
  // Note B belongs to organisation B; staff-a is scoped to A.
  expect((await act(page, "updateNote", { id: noteBId, body: "X" })).data).toBeNull();
  expect((await act(page, "deleteNote", { id: noteBId })).data).toBeNull();
  // Listing organisation B's customer from A returns nothing (its notes are not
  // in A), so the note is invisible across the tenant boundary.
  expect(
    await listIds(page, { related_type: "customer", related_id: custBId })
  ).not.toContain(noteBId);
});

test("a note cannot be created against a non-existent, cross-organisation or soft-deleted record", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  // Non-existent, cross-organisation, and soft-deleted records are rejected.
  expect(
    await createNote(page, {
      related_type: "customer",
      related_id: crypto.randomUUID(),
      body: "n1",
    })
  ).toBeNull();
  expect(
    await createNote(page, {
      related_type: "customer",
      related_id: custBId,
      body: "n2",
    })
  ).toBeNull();
  expect(
    await createNote(page, {
      related_type: "customer",
      related_id: custADeletedId,
      body: "n3",
    })
  ).toBeNull();

  // A valid record of each type is accepted.
  const valid: Array<[string, string]> = [
    ["lead", leadAId],
    ["customer", custAId],
    ["site", siteAId],
    ["quote", quoteAId],
  ];
  for (const [related_type, related_id] of valid) {
    const note = await createNote(page, {
      related_type,
      related_id,
      body: `Valid ${related_type} ${run}`,
    });
    expect(note?.related_type).toBe(related_type);
    expect(note?.related_id).toBe(related_id);
  }

  // An incomplete note is rejected at the schema boundary (400).
  expect(
    (await act(page, "createNote", { related_type: "customer", related_id: custAId }))
      .status
  ).toBe(400);
  expect(
    (await act(page, "createNote", { body: "no record" })).status
  ).toBe(400);
});

test("full lifecycle: create, list newest-first, update body, audited delete", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  const record = { related_type: "customer", related_id: custLifecycleId };

  // Three notes created in order; listing returns them newest first.
  const n1 = await createNote(page, { ...record, body: `First ${run}` });
  const n2 = await createNote(page, { ...record, body: `Second ${run}` });
  const n3 = await createNote(page, { ...record, body: `Third ${run}` });
  expect(await listIds(page, record)).toEqual([n3!.id, n2!.id, n1!.id]);

  // Update edits the body.
  const updated = (await act(page, "updateNote", { id: n1!.id, body: `First edited ${run}` }))
    .data as { body: string };
  expect(updated.body).toBe(`First edited ${run}`);

  // Delete is a permanent hard delete, audited (confirmed by a service-role
  // re-read of audit_log), and the note is gone from the list.
  const del = (await act(page, "deleteNote", { id: n2!.id })).data as { id: string };
  expect(del.id).toBe(n2!.id);
  expect(await auditCount("note.deleted", n2!.id)).toBe(1);
  expect(await listIds(page, record)).toEqual([n3!.id, n1!.id]);
});
