// Public quote page test for Pass 3I. Runs with: npm run test:quote-public
//
// Marking sent mints the token and the detail shows the copy control; the
// public page renders without any session (fresh browser contexts), stamps
// first_viewed_at exactly once, and Accept and Decline flip the quote
// through the guarded transitions with null-actor public_link audit rows.
// Draft, unknown and deleted tokens all 404, and a token only ever shows
// its own organisation's quote.

import { test, expect, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `qp-a-${run}`;
const emailFor = (label: string) => `${label}-${run}@quote-public.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
const planIds: string[] = [];
let custAId: string;
let acceptQuoteId: string;
let declineQuoteId: string;
let draftQuoteId: string;

async function seedQuote(
  orgId: string,
  customerId: string,
  quoteNumber: number,
  extra: Record<string, unknown> = {}
) {
  const quote = await admin
    .from("quotes")
    .insert({
      organisation_id: orgId,
      customer_id: customerId,
      quote_number: quoteNumber,
      title: `Public quote ${quoteNumber} ${run}`,
      ...extra,
    })
    .select("id")
    .single();
  if (quote.error) throw new Error(quote.error.message);
  const line = await admin.from("quote_line_items").insert([
    {
      organisation_id: orgId,
      quote_id: quote.data.id,
      position: 1,
      description: `Crane works ${run}`,
      quantity: 1,
      unit_price_pence: 159970,
      vat_rate: 20,
    },
    {
      organisation_id: orgId,
      quote_id: quote.data.id,
      position: 2,
      description: `Documentation ${run}`,
      quantity: 1,
      unit_price_pence: 5000,
      vat_rate: 0,
    },
  ]);
  if (line.error) throw new Error(line.error.message);
  return quote.data.id as string;
}

test.beforeAll(async () => {
  const orgA = await admin
    .from("organisations")
    .insert({ name: `Public Quotes Co ${run}`, slug: slugA })
    .select("id")
    .single();
  if (orgA.error) throw new Error(orgA.error.message);
  orgIds.a = orgA.data.id;

  const plan = await admin
    .from("plans")
    .insert({ key: `qp-${run}`, name: "QP", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planIds.push(plan.data.id);
  const linked = await admin
    .from("plan_modules")
    .insert({ plan_id: plan.data.id, module: "quotes" });
  if (linked.error) throw new Error(linked.error.message);
  const assigned = await admin.rpc("assign_plan", {
    org_id: orgIds.a,
    new_plan_id: plan.data.id,
  });
  if (assigned.error) throw new Error(assigned.error.message);

  const user = await admin.auth.admin.createUser({
    email: emailFor("staff-a"),
    password,
    email_confirm: true,
  });
  if (user.error || !user.data.user) throw new Error(user.error?.message);
  userIds.push(user.data.user.id);
  const membership = await admin.from("organisation_memberships").insert({
    organisation_id: orgIds.a,
    user_id: user.data.user.id,
    role: "staff",
    status: "active",
  });
  if (membership.error) throw new Error(membership.error.message);

  const customer = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.a, name: `Public Customer ${run}` })
    .select("id")
    .single();
  if (customer.error) throw new Error(customer.error.message);
  custAId = customer.data.id;

  acceptQuoteId = await seedQuote(orgIds.a, custAId, 1);
  declineQuoteId = await seedQuote(orgIds.a, custAId, 2);
  draftQuoteId = await seedQuote(orgIds.a, custAId, 3);
});

test.afterAll(async () => {
  const ids = Object.values(orgIds);
  await admin.from("audit_log").delete().in("organisation_id", ids);
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

async function markSent(page: Page, quoteId: string) {
  const response = await page.request.post(`/api/quotes-harness/${slugA}`, {
    data: {
      action: "transitionQuoteStatus",
      input: { id: quoteId, to: "sent" },
    },
  });
  expect(response.status()).toBe(200);
}

async function tokenOf(quoteId: string) {
  const { data } = await admin
    .from("quotes")
    .select("public_token")
    .eq("id", quoteId)
    .single();
  return data?.public_token as string | null;
}

async function publicPage(browser: Browser, token: string) {
  const context = await browser.newContext();
  return context.newPage().then(async (page) => {
    await page.goto(`/q/${token}`);
    return page;
  });
}

test("sending mints the token, the public page renders and stamps once", async ({
  page,
  browser,
}) => {
  await signIn(page, "staff-a");

  // Draft: no token yet, nothing public to show.
  expect(await tokenOf(acceptQuoteId)).toBeNull();

  await markSent(page, acceptQuoteId);
  const token = await tokenOf(acceptQuoteId);
  expect(token).not.toBeNull();
  expect(token!.length).toBeGreaterThanOrEqual(40);

  // The detail shows the copy control with the link path.
  await page.goto(`/app/${slugA}/quotes/${acceptQuoteId}`);
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(page.getByText(`/q/${token!.slice(0, 12)}`)).toBeVisible();

  // A fresh, session-less browser context sees the document.
  const publicView = await publicPage(browser, token!);
  await expect(
    publicView.getByText(`Public Quotes Co ${run}`).first()
  ).toBeVisible();
  await expect(
    publicView.getByText(`Quote #1 Public quote 1 ${run}`)
  ).toBeVisible();
  await expect(publicView.getByText(`Crane works ${run}`)).toBeVisible();
  await expect(publicView.getByText("£1,649.70")).toBeVisible();
  await expect(publicView.getByText("£319.94")).toBeVisible();
  await expect(publicView.getByText("£1,969.64")).toBeVisible();
  await expect(
    publicView.getByRole("button", { name: "Accept quote" })
  ).toBeVisible();

  // First view stamped once; a second view does not change it.
  const first = await admin
    .from("quotes")
    .select("first_viewed_at")
    .eq("id", acceptQuoteId)
    .single();
  expect(first.data?.first_viewed_at).not.toBeNull();
  await publicView.reload();
  const second = await admin
    .from("quotes")
    .select("first_viewed_at")
    .eq("id", acceptQuoteId)
    .single();
  expect(second.data?.first_viewed_at).toBe(first.data?.first_viewed_at);
  await publicView.context().close();
});

test("the customer accepts and both sides reflect it", async ({
  page,
  browser,
}) => {
  const token = await tokenOf(acceptQuoteId);
  const publicView = await publicPage(browser, token!);

  await publicView.getByRole("button", { name: "Accept quote" }).click();
  await expect(
    publicView.getByRole("alertdialog").getByText("you accept the quote")
  ).toBeVisible();
  await publicView
    .getByRole("alertdialog")
    .getByRole("button", { name: "Accept quote" })
    .click();
  await expect(publicView.getByText(/was accepted on/)).toBeVisible();
  await expect(
    publicView.getByRole("button", { name: "Accept quote" })
  ).toHaveCount(0);

  const state = await admin
    .from("quotes")
    .select("status")
    .eq("id", acceptQuoteId)
    .single();
  expect(state.data?.status).toBe("accepted");
  const audit = await admin
    .from("audit_log")
    .select("actor_user_id, metadata")
    .eq("target_id", acceptQuoteId)
    .eq("action", "quote.accepted");
  expect(audit.data?.length).toBe(1);
  expect(audit.data![0].actor_user_id).toBeNull();
  expect((audit.data![0].metadata as { source?: string }).source).toBe(
    "public_link"
  );

  // The app's detail reflects it.
  await signIn(page, "staff-a");
  await page.goto(`/app/${slugA}/quotes/${acceptQuoteId}`);
  await expect(page.getByText("accepted", { exact: true })).toBeVisible();
  await publicView.context().close();
});

test("the customer declines the other quote", async ({ page, browser }) => {
  await signIn(page, "staff-a");
  await markSent(page, declineQuoteId);
  const token = await tokenOf(declineQuoteId);

  const publicView = await publicPage(browser, token!);
  await publicView.getByRole("button", { name: "Decline" }).click();
  await publicView
    .getByRole("alertdialog")
    .getByRole("button", { name: "Decline quote" })
    .click();
  await expect(publicView.getByText("was declined")).toBeVisible();

  const state = await admin
    .from("quotes")
    .select("status")
    .eq("id", declineQuoteId)
    .single();
  expect(state.data?.status).toBe("declined");
  const audit = await admin
    .from("audit_log")
    .select("actor_user_id, metadata")
    .eq("target_id", declineQuoteId)
    .eq("action", "quote.declined");
  expect(audit.data?.length).toBe(1);
  expect(audit.data![0].actor_user_id).toBeNull();
  expect((audit.data![0].metadata as { source?: string }).source).toBe(
    "public_link"
  );
  await publicView.context().close();
});

test("draft, unknown and deleted tokens reveal nothing", async ({
  browser,
}) => {
  // A draft has no token at all.
  expect(await tokenOf(draftQuoteId)).toBeNull();

  // Unknown token: generic 404.
  const context = await browser.newContext();
  const page = await context.newPage();
  const unknown = await page.goto(`/q/${"x".repeat(43)}`);
  expect(unknown?.status()).toBe(404);

  // A deleted quote's token 404s too.
  const token = await tokenOf(declineQuoteId);
  await admin
    .from("quotes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", declineQuoteId);
  const deleted = await page.goto(`/q/${token}`);
  expect(deleted?.status()).toBe(404);
  await context.close();
});

test("a token shows only its own organisation's quote", async ({ browser }) => {
  // A second organisation with its own quote and token.
  const orgB = await admin
    .from("organisations")
    .insert({ name: `Other Public Co ${run}`, slug: `qp-b-${run}` })
    .select("id")
    .single();
  if (orgB.error) throw new Error(orgB.error.message);
  orgIds.b = orgB.data.id;
  const custB = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.b, name: `B Customer ${run}` })
    .select("id")
    .single();
  if (custB.error) throw new Error(custB.error.message);
  const tokenB = `tokenB-${run}-${"b".repeat(30)}`;
  const quoteB = await admin
    .from("quotes")
    .insert({
      organisation_id: orgIds.b,
      customer_id: custB.data.id,
      quote_number: 1,
      title: `B quote ${run}`,
      status: "sent",
      public_token: tokenB,
    })
    .select("id")
    .single();
  if (quoteB.error) throw new Error(quoteB.error.message);

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/q/${tokenB}`);
  await expect(page.getByText(`Other Public Co ${run}`).first()).toBeVisible();
  await expect(page.getByText(`Public Quotes Co ${run}`)).toHaveCount(0);
  await expect(page.getByText(`Public quote 1 ${run}`)).toHaveCount(0);
  await context.close();
});
