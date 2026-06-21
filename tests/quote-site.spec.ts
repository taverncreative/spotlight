// Quote-to-site test for Pass 5D. Runs with: npm run test:quote-site
//
// Proves the optional site link end to end: the builder offers the quote
// customer's active sites and saving sets quotes.site_id; the site then shows
// on the in-app detail, the public page and the PDF; clearing it works;
// choosing a site from another customer or organisation is rejected (the
// action's validation and the composite FK); changing the quote's customer to
// one that does not own the site clears it; and hard-deleting the site nulls
// the quote's link while the quote survives (ON DELETE SET NULL).

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import zlib from "node:zlib";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `qs-a-${run}`;
const slugB = `qs-b-${run}`;
const emailFor = (label: string) => `${label}-${run}@quote-site.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
let planId: string;
let custX: string;
let custY: string;
let custB: string;
const sites: Record<string, { id: string; name: string }> = {};

async function seedSite(orgLabel: string, customerId: string, name: string) {
  const { data, error } = await admin
    .from("sites")
    .insert({ organisation_id: orgIds[orgLabel], customer_id: customerId, name })
    .select("id, name")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, name: data.name as string };
}

async function seedCustomer(orgLabel: string, name: string) {
  const { data, error } = await admin
    .from("customers")
    .insert({ organisation_id: orgIds[orgLabel], name })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

function extractPdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  let out = "";
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  const hexToLatin1 = (hex: string) => {
    let s = "";
    for (let i = 0; i + 1 < hex.length; i += 2) {
      s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return s;
  };
  while ((m = streamRe.exec(raw)) !== null) {
    let content: string;
    try {
      content = zlib.inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
    } catch {
      content = m[1];
    }
    for (const h of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      out += hexToLatin1(h[1]);
    }
  }
  return out;
}

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["b", slugB],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Quote Site ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  const plan = await admin
    .from("plans")
    .insert({ key: `qs-${run}`, name: "QS", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planId = plan.data.id;
  for (const moduleKey of ["quotes", "customers"]) {
    const linked = await admin
      .from("plan_modules")
      .insert({ plan_id: planId, module: moduleKey });
    if (linked.error) throw new Error(linked.error.message);
  }
  for (const label of ["a", "b"]) {
    const assigned = await admin.rpc("assign_plan", {
      org_id: orgIds[label],
      new_plan_id: planId,
    });
    if (assigned.error) throw new Error(assigned.error.message);
  }

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

  custX = await seedCustomer("a", `Customer X ${run}`);
  custY = await seedCustomer("a", `Customer Y ${run}`);
  custB = await seedCustomer("b", `Customer B ${run}`);
  sites.x1 = await seedSite("a", custX, `Chatham yard ${run}`);
  sites.x2 = await seedSite("a", custX, `Gillingham slipway ${run}`);
  sites.y1 = await seedSite("a", custY, `Maidstone depot ${run}`);
  sites.b1 = await seedSite("b", custB, `Dover wharf ${run}`);
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

async function quoteAction(page: Page, action: string, input: unknown) {
  const response = await page.request.post(`/api/quotes-harness/${slugA}`, {
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

async function newDraftQuote(page: Page, customerId: string) {
  const created = (await quoteAction(page, "createQuote", { customer_id: customerId }))
    .data as { id: string };
  await quoteAction(page, "addLineItem", {
    quote_id: created.id,
    description: `Crane works ${run}`,
    unit_price_pence: 50000,
  });
  return created.id;
}

async function siteIdOf(quoteId: string) {
  const { data } = await admin
    .from("quotes")
    .select("site_id")
    .eq("id", quoteId)
    .single();
  return (data?.site_id as string | null) ?? null;
}

test("the builder offers the customer's sites, saving sets it, and clearing works", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  const quoteId = await newDraftQuote(page, custX);
  await page.goto(`/app/${slugA}/quotes/${quoteId}/edit`);

  // The picker offers the customer's two sites and a no-site option, and not
  // another customer's site.
  const sitePicker = page.getByLabel("Site");
  await expect(sitePicker).toContainText(sites.x1.name);
  await expect(sitePicker).toContainText(sites.x2.name);
  await expect(sitePicker).toContainText("No site");
  await expect(sitePicker).not.toContainText(sites.y1.name);

  // Save header redirects back to the same builder URL, so there is no URL
  // change to wait on; wait for the server-action POST to settle before
  // reading the row, otherwise the read races the action.
  const editPost = new RegExp(`/quotes/${quoteId}/edit$`);
  const waitSave = () =>
    page.waitForResponse(
      (r) => r.request().method() === "POST" && editPost.test(r.url())
    );

  await sitePicker.selectOption({ label: sites.x1.name });
  await Promise.all([waitSave(), page.getByRole("button", { name: "Save header" }).click()]);
  expect(await siteIdOf(quoteId)).toBe(sites.x1.id);

  // The detail view shows the site.
  await page.goto(`/app/${slugA}/quotes/${quoteId}`);
  await expect(page.getByText(`Site: ${sites.x1.name}`)).toBeVisible();

  // Clearing it via the picker.
  await page.goto(`/app/${slugA}/quotes/${quoteId}/edit`);
  await page.getByLabel("Site").selectOption({ label: "No site" });
  await Promise.all([waitSave(), page.getByRole("button", { name: "Save header" }).click()]);
  expect(await siteIdOf(quoteId)).toBeNull();
  await page.goto(`/app/${slugA}/quotes/${quoteId}`);
  await expect(page.getByText(`Site: ${sites.x1.name}`)).toHaveCount(0);
});

test("the site shows on the public page and in both PDFs", async ({ page }) => {
  await signIn(page, "staff-a");
  const quoteId = await newDraftQuote(page, custX);
  expect((await quoteAction(page, "updateQuote", { id: quoteId, site_id: sites.x1.id })).data).not.toBeNull();
  // Send it so the public surfaces and the in-app PDF become available.
  await quoteAction(page, "transitionQuoteStatus", { id: quoteId, to: "sent" });
  const { data: tokenRow } = await admin
    .from("quotes")
    .select("public_token")
    .eq("id", quoteId)
    .single();
  const token = tokenRow!.public_token as string;

  // Public page.
  await page.goto(`/q/${token}`);
  await expect(page.getByText(`Site: ${sites.x1.name}`)).toBeVisible();

  // Public PDF.
  const publicPdf = await page.request.get(`/q/${token}/pdf`);
  expect(extractPdfText(await publicPdf.body())).toContain(`Site: ${sites.x1.name}`);

  // In-app PDF.
  const appPdf = await page.request.get(`/app/${slugA}/quotes/${quoteId}/pdf`);
  expect(extractPdfText(await appPdf.body())).toContain(`Site: ${sites.x1.name}`);
});

test("a site from another customer or organisation is rejected", async ({ page }) => {
  await signIn(page, "staff-a");
  const quoteId = await newDraftQuote(page, custX);

  // Another customer's site: validation returns null and nothing is set.
  expect((await quoteAction(page, "updateQuote", { id: quoteId, site_id: sites.y1.id })).data).toBeNull();
  expect(await siteIdOf(quoteId)).toBeNull();

  // Another organisation's site: also rejected.
  expect((await quoteAction(page, "updateQuote", { id: quoteId, site_id: sites.b1.id })).data).toBeNull();
  expect(await siteIdOf(quoteId)).toBeNull();

  // The composite FK is the backstop: a raw service-role update with a foreign
  // organisation's site is refused by the database itself.
  const fk = await admin
    .from("quotes")
    .update({ site_id: sites.b1.id })
    .eq("id", quoteId);
  expect(fk.error).not.toBeNull();
});

test("changing the customer to one that does not own the site clears it", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  const quoteId = await newDraftQuote(page, custX);
  expect((await quoteAction(page, "updateQuote", { id: quoteId, site_id: sites.x1.id })).data).not.toBeNull();
  expect(await siteIdOf(quoteId)).toBe(sites.x1.id);

  // Move the quote to customer Y, who does not own Chatham yard.
  const moved = await quoteAction(page, "updateQuote", { id: quoteId, customer_id: custY });
  expect(moved.data).not.toBeNull();
  expect(await siteIdOf(quoteId)).toBeNull();
});

test("hard-deleting the site nulls the quote's link and the quote survives", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  const quoteId = await newDraftQuote(page, custX);
  expect((await quoteAction(page, "updateQuote", { id: quoteId, site_id: sites.x2.id })).data).not.toBeNull();
  expect(await siteIdOf(quoteId)).toBe(sites.x2.id);

  // A real delete of the site (the FK backstop, not the soft-delete action).
  const del = await admin.from("sites").delete().eq("id", sites.x2.id);
  expect(del.error).toBeNull();

  // The quote still exists, with its link nulled by ON DELETE SET NULL.
  const { data: stillThere } = await admin
    .from("quotes")
    .select("id, site_id, organisation_id")
    .eq("id", quoteId)
    .single();
  expect(stillThere?.id).toBe(quoteId);
  expect(stillThere?.site_id).toBeNull();
  expect(stillThere?.organisation_id).toBe(orgIds.a);
});
