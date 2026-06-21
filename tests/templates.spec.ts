// Templates test for Pass 9A. Runs with: npm run test:templates
//
// Two parts in one command. First, the real templates actions through the
// harness route with real signed-in sessions per role: organisation A has the
// templates module, organisation B does not. It proves tenant isolation,
// read_only reads but cannot write, staff and manager can write, an organisation
// without the templates entitlement is denied (403), cross-tenant actions are a
// calm null, and the CRUD lifecycle (create, list by category, update, audited
// delete). Second, the pure fill engine by direct import: a full context fills
// every placeholder, missing and unknown tokens render empty, and a value
// containing {{...}} or other characters cannot inject or crash.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { fillTemplate } from "../lib/templates/fill";
import { MERGE_FIELD_TOKENS } from "../lib/templates/merge-fields";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `tpl-a-${run}`;
const slugB = `tpl-b-${run}`;
const emailFor = (label: string) => `${label}-${run}@templates.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
const planIds: string[] = [];
let templateBId: string;

async function makePlan(label: string, modules: string[]) {
  const plan = await admin
    .from("plans")
    .insert({ key: `tpl-${label}-${run}`, name: "TPL", monthly_price_pence: 1000 })
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
      .insert({ name: `Templates ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  // A has templates; B does not (customers only), so B's member is denied and a
  // template placed in B by the admin is invisible to A.
  await makePlan("a", ["templates"]);
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

  // A template in organisation B (admin bypasses RLS and the module gate), for
  // the cross-tenant checks.
  const templateB = await admin
    .from("templates")
    .insert({
      organisation_id: orgIds.b,
      name: `B template ${run}`,
      category: "general",
      subject: "B subject",
      body: "B body",
    })
    .select("id")
    .single();
  if (templateB.error) throw new Error(templateB.error.message);
  templateBId = templateB.data.id;
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
  const response = await page.request.post(`/api/templates-harness/${slug}`, {
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

type TemplateRow = Record<string, unknown> & { id: string };

async function createTemplate(
  page: Page,
  input: Record<string, unknown>,
  slug = slugA
) {
  return (await act(page, "createTemplate", input, slug)).data as TemplateRow | null;
}

async function listIds(page: Page, input: Record<string, unknown> = {}, slug = slugA) {
  const { data } = await act(page, "listTemplates", input, slug);
  return ((data as { id: string }[]) ?? []).map((t) => t.id);
}

async function auditCount(action: string, targetId: string) {
  const { data } = await admin
    .from("audit_log")
    .select("id")
    .eq("action", action)
    .eq("target_id", targetId);
  return data?.length ?? 0;
}

test("read_only reads templates but cannot write them", async ({ page }) => {
  await signIn(page, "readonly-a");

  expect((await act(page, "listTemplates", {})).status).toBe(200);
  expect((await act(page, "getTemplate", { id: crypto.randomUUID() })).status).toBe(200);

  const id = crypto.randomUUID();
  expect(
    (await act(page, "createTemplate", {
      name: "RO",
      category: "general",
      body: "x",
    })).status
  ).toBe(403);
  expect((await act(page, "updateTemplate", { id, name: "RO" })).status).toBe(403);
  expect((await act(page, "deleteTemplate", { id })).status).toBe(403);
});

test("staff and manager can write templates", async ({ page }) => {
  await signIn(page, "manager-a");
  const byManager = await createTemplate(page, {
    name: `Manager template ${run}`,
    category: "general",
    body: "Manager body",
  });
  expect(byManager?.id).toBeTruthy();

  await signIn(page, "staff-a");
  const byStaff = await createTemplate(page, {
    name: `Staff template ${run}`,
    category: "general",
    body: "Staff body",
  });
  expect(byStaff?.id).toBeTruthy();
});

test("an organisation without the templates entitlement is denied", async ({ page }) => {
  await signIn(page, "staff-b");
  expect((await act(page, "listTemplates", {}, slugB)).status).toBe(403);
  expect((await act(page, "getTemplate", { id: crypto.randomUUID() }, slugB)).status).toBe(403);
  expect(
    (await act(page, "createTemplate", {
      name: "B",
      category: "general",
      body: "x",
    }, slugB)).status
  ).toBe(403);
});

test("cross-tenant template actions are rejected", async ({ page }) => {
  await signIn(page, "staff-a");
  // Template B belongs to organisation B; staff-a is scoped to A.
  expect((await act(page, "getTemplate", { id: templateBId })).data).toBeNull();
  expect((await act(page, "updateTemplate", { id: templateBId, name: "X" })).data).toBeNull();
  expect((await act(page, "deleteTemplate", { id: templateBId })).data).toBeNull();
  expect(await listIds(page)).not.toContain(templateBId);
  // The delete touched nothing: B's template still exists (admin re-read).
  const survives = await admin.from("templates").select("id").eq("id", templateBId).maybeSingle();
  expect(survives.data?.id).toBe(templateBId);
});

test("full lifecycle: create, list by category, update, audited delete", async ({ page }) => {
  await signIn(page, "staff-a");

  const sent = await createTemplate(page, {
    name: `Quote sent ${run}`,
    category: "quote_sent",
    subject: "Your quote {{quote_number}}",
    body: "Hello {{contact_name}}, your quote total is {{quote_total}}.",
  });
  const chase = await createTemplate(page, {
    name: `Quote chase ${run}`,
    category: "quote_chase",
    body: "Just chasing quote {{quote_number}}.",
  });
  expect(sent?.id).toBeTruthy();
  expect(chase?.id).toBeTruthy();
  expect(sent?.subject).toBe("Your quote {{quote_number}}");

  // Listing by category returns only that category's templates.
  const sentList = await listIds(page, { category: "quote_sent" });
  expect(sentList).toContain(sent!.id);
  expect(sentList).not.toContain(chase!.id);

  // Listing all returns both.
  const all = await listIds(page);
  expect(all).toContain(sent!.id);
  expect(all).toContain(chase!.id);

  // Update changes the provided fields only.
  const updated = (await act(page, "updateTemplate", {
    id: sent!.id,
    name: `Quote sent edited ${run}`,
    category: "general",
    subject: "Edited subject",
  })).data as TemplateRow;
  expect(updated.name).toBe(`Quote sent edited ${run}`);
  expect(updated.category).toBe("general");
  expect(updated.subject).toBe("Edited subject");
  expect(updated.body).toBe("Hello {{contact_name}}, your quote total is {{quote_total}}.");

  // Delete is a permanent hard delete, audited, and gone from the list.
  const del = (await act(page, "deleteTemplate", { id: chase!.id })).data as { id: string };
  expect(del.id).toBe(chase!.id);
  expect(await auditCount("template.deleted", chase!.id)).toBe(1);
  expect(await listIds(page)).not.toContain(chase!.id);
});

// --- The pure fill engine (no session needed) ---

test("the fill engine fills a full context across subject and body", () => {
  const result = fillTemplate(
    {
      subject: "Quote {{quote_number}} for {{business_name}}",
      body: "Hi {{ contact_name }}, total {{quote_total}}, view it at {{quote_link}}.",
    },
    {
      quote_number: "1042",
      business_name: "Harbour Marine",
      contact_name: "Dave",
      quote_total: "£1,200.00",
      quote_link: "https://example.test/q/abc",
    }
  );
  expect(result.subject).toBe("Quote 1042 for Harbour Marine");
  expect(result.body).toBe("Hi Dave, total £1,200.00, view it at https://example.test/q/abc.");
  // The catalogue tokens are the documented set a UI would offer.
  expect(MERGE_FIELD_TOKENS).toContain("contact_name");
  expect(MERGE_FIELD_TOKENS).toContain("quote_link");
});

test("missing and unknown tokens render empty, never the raw token", () => {
  const result = fillTemplate(
    { subject: "Hi {{contact_name}}", body: "{{contact_name}} / {{not_a_real_token}} / done" },
    {} // empty context: every token is missing
  );
  expect(result.subject).toBe("Hi ");
  expect(result.body).toBe(" /  / done");
  // A token present but null also renders empty.
  const withNull = fillTemplate(
    { subject: null, body: "Name: {{contact_name}}." },
    { contact_name: null }
  );
  expect(withNull.subject).toBe("");
  expect(withNull.body).toBe("Name: .");
});

test("a value cannot inject placeholders or special characters", () => {
  // A value that itself contains a placeholder is inserted literally and never
  // re-scanned, so it cannot pull in another context value (no recursion).
  const injected = fillTemplate(
    { subject: null, body: "Hi {{contact_name}}, total {{quote_total}}." },
    { contact_name: "{{quote_total}}", quote_total: "£5,000" }
  );
  expect(injected.body).toBe("Hi {{quote_total}}, total £5,000.");

  // `$` sequences in a value are literal (a replacer function is used, so no
  // $1/$& interpretation).
  const dollars = fillTemplate(
    { subject: null, body: "Ref {{contact_name}}" },
    { contact_name: "A$1$&B$$C" }
  );
  expect(dollars.body).toBe("Ref A$1$&B$$C");

  // Ordinary braces and malformed tokens that are not the {{token}} shape are
  // left untouched, and nothing throws on odd input.
  const literal = fillTemplate(
    { subject: null, body: "Keep { this } and {{ not a token }} and {{}} as-is" },
    {}
  );
  expect(literal.body).toBe("Keep { this } and {{ not a token }} and {{}} as-is");
});
