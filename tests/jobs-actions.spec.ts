// Jobs server-action test for Phase 2, Pass 1. Runs with:
// npm run test:jobs-actions
//
// Exercises the real jobs actions through the harness route with real signed-in
// sessions per role. Organisations A and B have the jobs module via a real
// assign_plan call; organisation N has none. Proves: read_only reads but cannot
// write, staff and manager can write, an organisation without the jobs
// entitlement is denied (403), and cross-tenant actions are a calm null. Plus the
// lifecycle (create, schedule, the status transitions, delete with an audit row),
// the assignee integrity check (a non-member and a cross-organisation user
// rejected), the customer and site checks (a cross-tenant customer and a site not
// belonging to the customer rejected), and create-from-quote (the new job carries
// the quote's customer, site and title, and links back to the quote).

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `ja-a-${run}`;
const slugB = `ja-b-${run}`;
const slugN = `ja-n-${run}`;
const emailFor = (label: string) => `${label}-${run}@jobs-actions.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
let planId: string;
let staffAId: string;
let staffBId: string;
let nonMemberId: string;
let custAId: string;
let custA2Id: string;
let siteAId: string;
let siteA2Id: string;
let custBId: string;
let quoteAId: string;
let jobBId: string;

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["b", slugB],
    ["n", slugN],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Jobs Actions ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  const plan = await admin
    .from("plans")
    .insert({ key: `ja-${run}`, name: "JA", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planId = plan.data.id;
  const linked = await admin
    .from("plan_modules")
    .insert({ plan_id: planId, module: "jobs" });
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
    ["staff-b", "b", "staff"],
    ["admin-n", "n", "client_admin"],
  ];
  const userByLabel: Record<string, string> = {};
  for (const [label, orgLabel, role] of members) {
    const user = await admin.auth.admin.createUser({
      email: emailFor(label),
      password,
      email_confirm: true,
    });
    if (user.error || !user.data.user) throw new Error(user.error?.message);
    userIds.push(user.data.user.id);
    userByLabel[label] = user.data.user.id;
    const membership = await admin.from("organisation_memberships").insert({
      organisation_id: orgIds[orgLabel],
      user_id: user.data.user.id,
      role,
      status: "active",
    });
    if (membership.error) throw new Error(membership.error.message);
  }
  staffAId = userByLabel["staff-a"];
  staffBId = userByLabel["staff-b"];

  const nonMember = await admin.auth.admin.createUser({
    email: emailFor("nonmember"),
    password,
    email_confirm: true,
  });
  if (nonMember.error || !nonMember.data.user) {
    throw new Error(nonMember.error?.message);
  }
  nonMemberId = nonMember.data.user.id;
  userIds.push(nonMemberId);

  // Two customers in organisation A, each with a site, so a site that does not
  // belong to the chosen customer can be tested. One customer in organisation B
  // for the cross-tenant customer check.
  const custA = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.a, name: `Customer A ${run}` })
    .select("id")
    .single();
  if (custA.error) throw new Error(custA.error.message);
  custAId = custA.data.id;

  const custA2 = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.a, name: `Customer A2 ${run}` })
    .select("id")
    .single();
  if (custA2.error) throw new Error(custA2.error.message);
  custA2Id = custA2.data.id;

  const siteA = await admin
    .from("sites")
    .insert({ organisation_id: orgIds.a, customer_id: custAId, name: `Site A ${run}` })
    .select("id")
    .single();
  if (siteA.error) throw new Error(siteA.error.message);
  siteAId = siteA.data.id;

  const siteA2 = await admin
    .from("sites")
    .insert({ organisation_id: orgIds.a, customer_id: custA2Id, name: `Site A2 ${run}` })
    .select("id")
    .single();
  if (siteA2.error) throw new Error(siteA2.error.message);
  siteA2Id = siteA2.data.id;

  const quoteA = await admin
    .from("quotes")
    .insert({
      organisation_id: orgIds.a,
      customer_id: custAId,
      site_id: siteAId,
      quote_number: 9101,
      title: `Crane works ${run}`,
    })
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

  // A job in organisation B, for the cross-tenant by-id checks.
  const jobB = await admin
    .from("jobs")
    .insert({
      organisation_id: orgIds.b,
      customer_id: custBId,
      title: `Job B ${run}`,
    })
    .select("id")
    .single();
  if (jobB.error) throw new Error(jobB.error.message);
  jobBId = jobB.data.id;
});

test.afterAll(async () => {
  const ids = Object.values(orgIds);
  await admin.from("audit_log").delete().in("organisation_id", ids);
  // Jobs RESTRICT their customers' deletion, so clear jobs before the org cascade.
  await admin.from("jobs").delete().in("organisation_id", ids);
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

type ActResult = { status: number; data: unknown };

async function act(
  page: Page,
  action: string,
  input: unknown = {},
  slug = slugA
): Promise<ActResult> {
  const response = await page.request.post(`/api/jobs-harness/${slug}`, {
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

type JobResult = (Record<string, unknown> & { id: string }) | null;

async function createJob(page: Page, input: Record<string, unknown>) {
  return (await act(page, "createJob", input)).data as JobResult;
}

async function listIds(page: Page, filter: Record<string, unknown> = {}) {
  const { data } = await act(page, "listJobs", filter);
  return ((data as { id: string }[]) ?? []).map((j) => j.id);
}

async function auditCount(action: string, targetId: string) {
  const { data } = await admin
    .from("audit_log")
    .select("id")
    .eq("action", action)
    .eq("target_id", targetId);
  return data?.length ?? 0;
}

test("read_only reads but cannot write jobs", async ({ page }) => {
  await signIn(page, "readonly-a");
  expect((await act(page, "listJobs", {})).status).toBe(200);

  const id = crypto.randomUUID();
  expect(
    (await act(page, "createJob", { title: "RO", customer_id: custAId })).status
  ).toBe(403);
  expect((await act(page, "updateJob", { id, title: "RO" })).status).toBe(403);
  expect(
    (await act(page, "scheduleJob", {
      id,
      scheduled_start: new Date().toISOString(),
    })).status
  ).toBe(403);
  expect(
    (await act(page, "setJobStatus", { id, status: "completed" })).status
  ).toBe(403);
  expect((await act(page, "deleteJob", { id })).status).toBe(403);
});

test("staff and manager can write; an org without the jobs entitlement is denied", async ({
  page,
}) => {
  await signIn(page, "manager-a");
  const byManager = await createJob(page, {
    title: `Manager job ${run}`,
    customer_id: custAId,
  });
  expect(byManager?.id).toBeTruthy();

  await signIn(page, "staff-a");
  const byStaff = await createJob(page, {
    title: `Staff job ${run}`,
    customer_id: custAId,
  });
  expect(byStaff?.id).toBeTruthy();

  await signIn(page, "admin-n");
  expect((await act(page, "listJobs", {}, slugN)).status).toBe(403);
  expect(
    (await act(page, "createJob", { title: "N", customer_id: custAId }, slugN))
      .status
  ).toBe(403);
});

test("cross-tenant actions are rejected with a calm null", async ({ page }) => {
  await signIn(page, "staff-a");
  // Job B belongs to organisation B; staff-a is scoped to A.
  expect((await act(page, "getJob", { id: jobBId })).data).toBeNull();
  expect((await act(page, "updateJob", { id: jobBId, title: "X" })).data).toBeNull();
  expect(
    (await act(page, "scheduleJob", {
      id: jobBId,
      scheduled_start: new Date().toISOString(),
    })).data
  ).toBeNull();
  expect(
    (await act(page, "setJobStatus", { id: jobBId, status: "completed" })).data
  ).toBeNull();
  expect((await act(page, "deleteJob", { id: jobBId })).data).toBeNull();
  expect(await listIds(page)).not.toContain(jobBId);
});

test("the customer and site links are validated", async ({ page }) => {
  await signIn(page, "staff-a");

  // A customer from another organisation is rejected.
  expect(await createJob(page, { title: "C1", customer_id: custBId })).toBeNull();

  // A site that does not belong to the chosen customer is rejected.
  expect(
    await createJob(page, {
      title: "C2",
      customer_id: custAId,
      site_id: siteA2Id,
    })
  ).toBeNull();

  // A valid customer and its own site are accepted.
  const ok = await createJob(page, {
    title: `Customer and site ${run}`,
    customer_id: custAId,
    site_id: siteAId,
  });
  expect(ok?.customer_id).toBe(custAId);
  expect(ok?.site_id).toBe(siteAId);

  // No customer at all is a 400 at the schema boundary.
  expect((await act(page, "createJob", { title: "C3" })).status).toBe(400);
});

test("the assignee must be an active member of the organisation", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  expect(
    await createJob(page, {
      title: "A1",
      customer_id: custAId,
      assigned_to: nonMemberId,
    })
  ).toBeNull();
  expect(
    await createJob(page, {
      title: "A2",
      customer_id: custAId,
      assigned_to: staffBId,
    })
  ).toBeNull();

  const ok = await createJob(page, {
    title: `Assigned ${run}`,
    customer_id: custAId,
    assigned_to: staffAId,
  });
  expect(ok?.assigned_to).toBe(staffAId);

  // The same rule applies on schedule.
  const j = await createJob(page, { title: `To schedule ${run}`, customer_id: custAId });
  expect(
    (await act(page, "scheduleJob", {
      id: j!.id,
      scheduled_start: new Date().toISOString(),
      assigned_to: nonMemberId,
    })).data
  ).toBeNull();
});

test("lifecycle: create, schedule, transitions, list filters, audited delete", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  const created = await createJob(page, {
    title: `Lifecycle ${run}`,
    customer_id: custAId,
  });
  const id = created!.id;
  expect(created!.status).toBe("unscheduled");

  // Scheduling sets the time and assignee and moves it to scheduled.
  const when = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const scheduled = (await act(page, "scheduleJob", {
    id,
    scheduled_start: when,
    assigned_to: staffAId,
  })).data as { status: string; scheduled_start: string; assigned_to: string };
  expect(scheduled.status).toBe("scheduled");
  // The stored timestamp is the same instant (PostgREST returns a +00:00 offset
  // rather than the Z the request used).
  expect(new Date(scheduled.scheduled_start).getTime()).toBe(
    new Date(when).getTime()
  );
  expect(scheduled.assigned_to).toBe(staffAId);

  // Status transitions through the working lifecycle and cancel.
  for (const status of ["in_progress", "completed", "cancelled"]) {
    const res = (await act(page, "setJobStatus", { id, status })).data as {
      status: string;
    };
    expect(res.status).toBe(status);
  }

  // Update a field.
  const updated = (await act(page, "updateJob", { id, title: `Lifecycle edited ${run}` }))
    .data as { title: string };
  expect(updated.title).toBe(`Lifecycle edited ${run}`);

  // Filter by status and assignee.
  expect(await listIds(page, { status: "cancelled" })).toContain(id);
  expect(await listIds(page, { assigned_to: staffAId })).toContain(id);

  // Delete is a permanent hard delete, audited.
  const del = (await act(page, "deleteJob", { id })).data as { id: string };
  expect(del.id).toBe(id);
  expect(await auditCount("job.deleted", id)).toBe(1);
  expect((await act(page, "getJob", { id })).data).toBeNull();
});

test("create-from-quote pre-fills the job and links it back to the quote", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  const result = (await act(page, "createJobFromQuote", { id: quoteAId })).data as {
    id: string;
  } | null;
  expect(result?.id).toBeTruthy();

  const job = (await act(page, "getJob", { id: result!.id })).data as {
    title: string;
    customer_id: string;
    site_id: string | null;
    quote_id: string | null;
    status: string;
  };
  expect(job.customer_id).toBe(custAId);
  expect(job.site_id).toBe(siteAId);
  expect(job.quote_id).toBe(quoteAId);
  expect(job.title).toBe(`Crane works ${run}`);
  expect(job.status).toBe("unscheduled");

  // A quote in another organisation cannot be used.
  await signIn(page, "staff-b");
  expect((await act(page, "createJobFromQuote", { id: quoteAId })).data).toBeNull();
});
