// Quote status flow test for Pass 3G. Runs with: npm run test:quote-status
//
// Proves the lifecycle through the real detail-view controls and the
// harness: draft to sent stamps issued_at and audits, editing locks outside
// draft and the builder redirects, back to draft clears the stamp and
// unlocks, sent to accepted is terminal, invalid moves are rejected calmly,
// read_only cannot transition, cross-tenant transitions touch nothing, and
// the builder shows Save line with a Done button back to detail.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `qt-a-${run}`;
const slugB = `qt-b-${run}`;
const emailFor = (label: string) => `${label}-${run}@quote-status.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
let planId: string;
let quoteAId: string;
let quoteA2Id: string;
let quoteBId: string;

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["b", slugB],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Status ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  const plan = await admin
    .from("plans")
    .insert({ key: `qt-${run}`, name: "QT", monthly_price_pence: 1000 })
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

  for (const [label, orgLabel, role] of [
    ["staff-a", "a", "staff"],
    ["readonly-a", "a", "read_only"],
  ] as const) {
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

  const seedQuote = async (orgLabel: "a" | "b", quoteNumber: number) => {
    const customer = await admin
      .from("customers")
      .insert({
        organisation_id: orgIds[orgLabel],
        name: `Cust ${orgLabel} ${quoteNumber}`,
      })
      .select("id")
      .single();
    if (customer.error) throw new Error(customer.error.message);
    const quote = await admin
      .from("quotes")
      .insert({
        organisation_id: orgIds[orgLabel],
        customer_id: customer.data.id,
        quote_number: quoteNumber,
        title: `Status quote ${orgLabel}${quoteNumber} ${run}`,
      })
      .select("id")
      .single();
    if (quote.error) throw new Error(quote.error.message);
    return quote.data.id as string;
  };
  quoteAId = await seedQuote("a", 1);
  quoteA2Id = await seedQuote("a", 2);
  quoteBId = await seedQuote("b", 1);
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

async function quoteState(id: string) {
  const { data } = await admin
    .from("quotes")
    .select("status, issued_at")
    .eq("id", id)
    .single();
  return data as { status: string; issued_at: string | null };
}

async function auditCount(quoteId: string, action: string) {
  const { data } = await admin
    .from("audit_log")
    .select("id")
    .eq("organisation_id", orgIds.a)
    .eq("target_id", quoteId)
    .eq("action", action);
  return data?.length ?? 0;
}

test("the full lifecycle through the detail controls", async ({ page }) => {
  await signIn(page, "staff-a");
  await page.goto(`/app/${slugA}/quotes/${quoteAId}`);

  // Draft: Edit and Mark as sent are offered.
  await expect(page.getByRole("link", { name: "Edit" })).toBeVisible();
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(
    page.getByRole("alertdialog").getByText("Editing will lock")
  ).toBeVisible();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Mark as sent" })
    .click();

  // Sent: stamped, audited, resolution controls shown, Edit gone.
  await expect(page.getByText("sent", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accepted" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  let state = await quoteState(quoteAId);
  expect(state.status).toBe("sent");
  expect(state.issued_at).not.toBeNull();
  expect(await auditCount(quoteAId, "quote.sent")).toBe(1);

  // Editing refuses while sent, and the builder redirects to detail.
  const headerEdit = await act(page, "updateQuote", {
    id: quoteAId,
    title: "Locked",
  });
  expect(headerEdit.data).toBeNull();
  const lineAdd = await act(page, "addLineItem", {
    quote_id: quoteAId,
    description: "Locked",
    unit_price_pence: 100,
  });
  expect(lineAdd.data).toBeNull();
  await page.goto(`/app/${slugA}/quotes/${quoteAId}/edit`);
  await expect(page).toHaveURL(new RegExp(`/app/${slugA}/quotes/${quoteAId}$`));

  // Back to draft: stamp cleared, audited, editing unlocked.
  await page.getByRole("button", { name: "Back to draft" }).click();
  await expect(page.getByText("draft", { exact: true })).toBeVisible();
  state = await quoteState(quoteAId);
  expect(state.status).toBe("draft");
  expect(state.issued_at).toBeNull();
  expect(await auditCount(quoteAId, "quote.returned_to_draft")).toBe(1);
  const unlocked = await act(page, "updateQuote", {
    id: quoteAId,
    title: `Unlocked ${run}`,
  });
  expect((unlocked.data as { title: string }).title).toBe(`Unlocked ${run}`);

  // Send again, then accept: terminal, audited, still locked.
  const resend = await act(page, "transitionQuoteStatus", {
    id: quoteAId,
    to: "sent",
  });
  expect((resend.data as { status: string }).status).toBe("sent");
  await page.goto(`/app/${slugA}/quotes/${quoteAId}`);
  await page.getByRole("button", { name: "Accepted" }).click();
  await expect(page.getByText("accepted", { exact: true })).toBeVisible();
  expect(await auditCount(quoteAId, "quote.accepted")).toBe(1);
  const afterAccept = await act(page, "transitionQuoteStatus", {
    id: quoteAId,
    to: "declined",
  });
  expect((afterAccept.data as { invalid?: boolean }).invalid).toBe(true);
  const stillLocked = await act(page, "updateQuote", {
    id: quoteAId,
    title: "Nope",
  });
  expect(stillLocked.data).toBeNull();
});

test("invalid moves, read_only and cross-tenant are all rejected", async ({
  page,
}) => {
  await signIn(page, "staff-a");

  // Draft straight to accepted is not a legal move.
  const invalid = await act(page, "transitionQuoteStatus", {
    id: quoteA2Id,
    to: "accepted",
  });
  expect((invalid.data as { invalid?: boolean }).invalid).toBe(true);
  expect((await quoteState(quoteA2Id)).status).toBe("draft");

  // Cross-tenant: organisation B's quote is untouchable from A.
  const cross = await act(page, "transitionQuoteStatus", {
    id: quoteBId,
    to: "sent",
  });
  expect(cross.status).toBe(200);
  expect(cross.data).toBeNull();
  const quoteB = await admin
    .from("quotes")
    .select("status, issued_at")
    .eq("id", quoteBId)
    .single();
  expect(quoteB.data?.status).toBe("draft");
  expect(quoteB.data?.issued_at).toBeNull();
});

test("read_only cannot transition and sees no lifecycle controls", async ({
  page,
}) => {
  await signIn(page, "readonly-a");

  await page.goto(`/app/${slugA}/quotes/${quoteA2Id}`);
  await expect(page.getByText(`Status quote a2 ${run}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark as sent" })).toHaveCount(
    0
  );
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);

  const denied = await act(page, "transitionQuoteStatus", {
    id: quoteA2Id,
    to: "sent",
  });
  expect(denied.status).toBe(403);
});

test("the builder offers Save line and Done returns to detail", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  await page.goto(`/app/${slugA}/quotes/${quoteA2Id}/edit`);

  await expect(page.getByRole("button", { name: "Save line" })).toBeVisible();
  await page.getByRole("link", { name: "Done" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/app/${slugA}/quotes/${quoteA2Id}$`)
  );
});
