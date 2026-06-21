// Form-management test for Pass 4B. Runs with: npm run test:webhook-forms
//
// Exercises the real form-management actions through a harness with real
// signed-in sessions, and the real public intake endpoint (Pass 4A) with no
// session, to prove the whole loop. A client_admin creates a form and sees
// its URL and token, and a submission to it lands as a lead; disabling makes a
// submission 404; regenerating issues a new token, 404s the old link and
// accepts the new one; a staff member sees the list but none of the
// management controls and is denied every write server-side; and forms are
// tenant-isolated.

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `wf-a-${run}`;
const slugB = `wf-b-${run}`;
const emailFor = (label: string) => `${label}-${run}@webhook-forms.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
let seedFormA: { id: string; token: string };
let formB: { id: string; token: string };

let ipSeq = 0;
function postLead(request: APIRequestContext, token: string, body: unknown) {
  ipSeq += 1;
  return request.post(`/api/lead-webhooks/${token}`, {
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${(ipSeq % 250) + 1}`,
    },
    data: JSON.stringify(body),
    failOnStatusCode: false,
  });
}

function callHarness(
  page: Page,
  slug: string,
  action: string,
  input?: unknown
) {
  return page.request.post(`/api/webhook-forms-harness/${slug}`, {
    data: { action, input },
    failOnStatusCode: false,
  });
}

async function signIn(page: Page, label: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(emailFor(label));
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\//);
}

async function createOrg(label: string, slug: string) {
  const org = await admin
    .from("organisations")
    .insert({ name: `Web Forms ${label} ${run}`, slug })
    .select("id")
    .single();
  if (org.error) throw new Error(org.error.message);
  orgIds[label] = org.data.id;
  const ent = await admin
    .from("organisation_entitlements")
    .insert({ organisation_id: org.data.id, module: "leads", source: "add_on" });
  if (ent.error) throw new Error(ent.error.message);
  return org.data.id;
}

async function addMember(label: string, orgLabel: string, role: string) {
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

async function seedForm(orgLabel: string, name: string) {
  const form = await admin
    .from("webhook_forms")
    .insert({ organisation_id: orgIds[orgLabel], name })
    .select("id, token")
    .single();
  if (form.error) throw new Error(form.error.message);
  return { id: form.data.id as string, token: form.data.token as string };
}

test.beforeAll(async () => {
  await createOrg("a", slugA);
  await createOrg("b", slugB);
  await addMember("admin-a", "a", "client_admin");
  await addMember("staff-a", "a", "staff");
  await addMember("admin-b", "b", "client_admin");
  seedFormA = await seedForm("a", `Seed form ${run}`);
  formB = await seedForm("b", `Org B form ${run}`);
});

test.afterAll(async () => {
  const ids = Object.values(orgIds);
  await admin.from("audit_log").delete().in("organisation_id", ids);
  await admin.from("leads").delete().in("organisation_id", ids);
  await admin.from("webhook_forms").delete().in("organisation_id", ids);
  await admin.from("organisations").delete().in("id", ids);
  await admin.from("webhook_rate_limits").delete().in("scope", ["token", "ip"]);
  for (const id of userIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

test("a client_admin creates a form, sees its URL and token, and a submission lands as a lead", async ({
  page,
  request,
}) => {
  await signIn(page, "admin-a");
  const created = await callHarness(page, slugA, "createWebhookForm", {
    name: `Contact ${run}`,
  });
  expect(created.status()).toBe(200);
  const form = (await created.json()).data;
  expect(form.name).toBe(`Contact ${run}`);
  expect(form.status).toBe("active");
  expect(typeof form.token).toBe("string");
  expect(form.token.length).toBeGreaterThanOrEqual(20);
  // The URL the developer wires in is the endpoint plus the token.
  const submissionPath = `/api/lead-webhooks/${form.token}`;

  const submitted = await postLead(request, form.token, {
    name: "Web Visitor",
    email: `web-${run}@example.com`,
    phone: "07700 900000",
    message: `Enquiry via ${run}`,
    company: "Visitor Co",
  });
  expect(submitted.status()).toBe(200);
  expect(submitted.url()).toContain(submissionPath);

  const { data: leads } = await admin
    .from("leads")
    .select("*")
    .eq("organisation_id", orgIds.a)
    .eq("email", `web-${run}@example.com`);
  expect(leads?.length).toBe(1);
  expect(leads![0].name).toBe("Web Visitor");
  expect(leads![0].source).toBe("website");
  expect(leads![0].status).toBe("new");
  expect(leads![0].webhook_form_id).toBe(form.id);
  expect(leads![0].raw_payload.company).toBe("Visitor Co");
});

test("disabling a form makes a submission to it 404 and creates no lead", async ({
  page,
  request,
}) => {
  await signIn(page, "admin-a");
  const created = await callHarness(page, slugA, "createWebhookForm", {
    name: `To disable ${run}`,
  });
  const form = (await created.json()).data;

  // Active first: a submission works.
  expect((await postLead(request, form.token, { message: "before" })).status()).toBe(200);

  const disabled = await callHarness(page, slugA, "setWebhookFormStatus", {
    id: form.id,
    status: "disabled",
  });
  expect(disabled.status()).toBe(200);
  expect((await disabled.json()).data.status).toBe("disabled");

  const after = await postLead(request, form.token, {
    email: `disabled-${run}@example.com`,
  });
  expect(after.status()).toBe(404);
  const { data: leads } = await admin
    .from("leads")
    .select("id")
    .eq("organisation_id", orgIds.a)
    .eq("email", `disabled-${run}@example.com`);
  expect(leads?.length).toBe(0);
});

test("regenerating issues a new token: the old link 404s and the new one works", async ({
  page,
  request,
}) => {
  await signIn(page, "admin-a");
  const created = await callHarness(page, slugA, "createWebhookForm", {
    name: `To rotate ${run}`,
  });
  const form = (await created.json()).data;
  const oldToken = form.token;

  const regenerated = await callHarness(
    page,
    slugA,
    "regenerateWebhookFormToken",
    { id: form.id }
  );
  expect(regenerated.status()).toBe(200);
  const newToken = (await regenerated.json()).data.token;
  expect(newToken).not.toBe(oldToken);

  // The old link is dead.
  expect((await postLead(request, oldToken, { message: "old" })).status()).toBe(404);

  // The new link works and lands a lead.
  const fresh = await postLead(request, newToken, {
    email: `rotated-${run}@example.com`,
    message: "new link",
  });
  expect(fresh.status()).toBe(200);
  const { data: leads } = await admin
    .from("leads")
    .select("id, webhook_form_id")
    .eq("organisation_id", orgIds.a)
    .eq("email", `rotated-${run}@example.com`);
  expect(leads?.length).toBe(1);
  expect(leads![0].webhook_form_id).toBe(form.id);
});

test("a staff member is denied every management action server-side", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  // Reading the list is allowed for any member.
  const list = await callHarness(page, slugA, "listWebhookForms");
  expect(list.status()).toBe(200);
  const ids = ((await list.json()).data as { id: string }[]).map((f) => f.id);
  expect(ids).toContain(seedFormA.id);

  // Every write is denied.
  expect(
    (await callHarness(page, slugA, "createWebhookForm", { name: "Nope" })).status()
  ).toBe(403);
  expect(
    (
      await callHarness(page, slugA, "setWebhookFormStatus", {
        id: seedFormA.id,
        status: "disabled",
      })
    ).status()
  ).toBe(403);
  expect(
    (
      await callHarness(page, slugA, "regenerateWebhookFormToken", {
        id: seedFormA.id,
      })
    ).status()
  ).toBe(403);
});

test("a staff member sees the forms list but no management controls", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  await page.goto(`/app/${slugA}/leads/forms`);

  // The list and the seeded form are visible.
  await expect(page.getByText(`Seed form ${run}`)).toBeVisible();
  // None of the management controls are rendered.
  await expect(page.getByRole("button", { name: "Create form" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Disable" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Regenerate link" })
  ).toHaveCount(0);
});

test("a client_admin sees the management controls", async ({ page }) => {
  await signIn(page, "admin-a");
  await page.goto(`/app/${slugA}/leads/forms`);
  await expect(page.getByText(`Seed form ${run}`)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create form" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Regenerate link" }).first()
  ).toBeVisible();
});

test("forms are tenant-isolated", async ({ page }) => {
  await signIn(page, "admin-a");

  // A's list never contains B's form.
  const list = await callHarness(page, slugA, "listWebhookForms");
  const ids = ((await list.json()).data as { id: string }[]).map((f) => f.id);
  expect(ids).toContain(seedFormA.id);
  expect(ids).not.toContain(formB.id);

  // Acting on B's form while scoped to A finds nothing (org-scoped query).
  const cross = await callHarness(page, slugA, "setWebhookFormStatus", {
    id: formB.id,
    status: "disabled",
  });
  expect(cross.status()).toBe(200);
  expect((await cross.json()).data).toBeNull();
  // B's form is untouched.
  const { data: bForm } = await admin
    .from("webhook_forms")
    .select("status")
    .eq("id", formB.id)
    .single();
  expect(bForm?.status).toBe("active");

  // And A's admin cannot reach B's workspace at all.
  const otherWorkspace = await callHarness(page, slugB, "listWebhookForms");
  expect(otherWorkspace.status()).toBe(404);
});
