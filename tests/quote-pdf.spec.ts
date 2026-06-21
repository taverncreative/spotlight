// Quote PDF download test for Pass 3J. Runs with: npm run test:quote-pdf
//
// Proves both download surfaces. Public: a sent quote's PDF downloads by its
// token alone with no session, the correct content type and an attachment
// filename, a valid non-empty %PDF whose extracted text carries the quote
// number and the total formatted by formatPence, and that total equals the
// database total. Draft, unknown and deleted tokens all 404 with no PDF, and
// a token only ever yields its own organisation's quote (the token is the
// only key on the public path). In app: the download works for a write and a
// read role, is a 404 before a quote is sent, and is denied for an
// organisation without the quotes entitlement. A many-line quote (Pass 3J
// hardening) proves pagination: the PDF spans more than one page and every
// line item description and the overall total survive the page break.
//
// PDF text is recovered by inflating pdf-lib's FlateDecode content streams
// (Node zlib) and decoding the WinAnsi hex strings shown by Tj operators, so
// the £ in the money survives. No PDF dependency in the test itself.

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import zlib from "node:zlib";
import { formatPence } from "../lib/currency";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `qpdf-a-${run}`;
const slugN = `qpdf-n-${run}`;
const emailFor = (label: string) => `${label}-${run}@quote-pdf.test`;
const tokenFor = (label: string) =>
  `tok-${label}-${run}-${crypto.randomUUID().replaceAll("-", "")}`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
const planIds: string[] = [];

const tokens = {
  sentA: tokenFor("sa"),
  draftA: tokenFor("da"),
  deletableA: tokenFor("xa"),
  sentB: tokenFor("sb"),
  manyA: tokenFor("ma"),
};

let sentQuoteId: string;
let draftQuoteId: string;
let deletableQuoteId: string;
let manyQuoteId: string;

// Enough line items to spill past a single A4 page (the generator fits ~28
// rows on the first page), so the PDF must paginate.
const MANY_LINES = 60;
const manyDescription = (i: number) =>
  `Line item ${String(i).padStart(2, "0")} ${run}`;

// Inflate every content stream and pull the text shown by Tj / TJ operators,
// decoding the WinAnsi hex strings pdf-lib writes (£ is byte 0xA3).
function extractPdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  let out = "";
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw)) !== null) {
    const bin = Buffer.from(m[1], "latin1");
    let content: string;
    try {
      content = zlib.inflateSync(bin).toString("latin1");
    } catch {
      content = m[1];
    }
    for (const h of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      out += hexToLatin1(h[1]);
    }
    for (const a of content.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
      for (const h of a[1].matchAll(/<([0-9A-Fa-f]+)>/g)) {
        out += hexToLatin1(h[1]);
      }
    }
  }
  return out;
}
function hexToLatin1(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  let s = "";
  for (let i = 0; i + 1 < clean.length; i += 2) {
    s += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  }
  return s;
}

// Count page objects by their /Type /Page dictionaries; the negative
// lookahead excludes the single /Type /Pages tree root.
function countPdfPages(pdf: Buffer): number {
  const raw = pdf.toString("latin1");
  return (raw.match(/\/Type\s*\/Page(?![s])/g) || []).length;
}

async function seedSentQuote(
  orgId: string,
  customerId: string,
  quoteNumber: number,
  status: string,
  token: string | null
) {
  const quote = await admin
    .from("quotes")
    .insert({
      organisation_id: orgId,
      customer_id: customerId,
      quote_number: quoteNumber,
      title: `PDF quote ${quoteNumber} ${run}`,
      status,
      public_token: token,
      issued_at: status === "draft" ? null : new Date().toISOString(),
      valid_until: "2099-12-31",
    })
    .select("id")
    .single();
  if (quote.error) throw new Error(quote.error.message);
  const lines = await admin.from("quote_line_items").insert([
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
  if (lines.error) throw new Error(lines.error.message);
  return quote.data.id as string;
}

async function seedManyLineQuote(
  orgId: string,
  customerId: string,
  quoteNumber: number,
  token: string
) {
  const quote = await admin
    .from("quotes")
    .insert({
      organisation_id: orgId,
      customer_id: customerId,
      quote_number: quoteNumber,
      title: `Big PDF quote ${quoteNumber} ${run}`,
      status: "sent",
      public_token: token,
      issued_at: new Date().toISOString(),
      valid_until: "2099-12-31",
    })
    .select("id")
    .single();
  if (quote.error) throw new Error(quote.error.message);
  const rows = Array.from({ length: MANY_LINES }, (_, idx) => ({
    organisation_id: orgId,
    quote_id: quote.data.id,
    position: idx + 1,
    description: manyDescription(idx + 1),
    quantity: 1,
    unit_price_pence: 1000 + idx,
    vat_rate: 20,
  }));
  const lines = await admin.from("quote_line_items").insert(rows);
  if (lines.error) throw new Error(lines.error.message);
  return quote.data.id as string;
}

async function dbTotal(quoteId: string) {
  const { data } = await admin
    .from("quotes")
    .select("total_pence")
    .eq("id", quoteId)
    .single();
  return data!.total_pence as number;
}

test.beforeAll(async () => {
  // Organisation A: the quotes module via a real plan, two roles, a customer
  // and several quotes. Organisation N: no plan, no entitlements.
  for (const [label, slug] of [
    ["a", slugA],
    ["n", slugN],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `PDF Quotes ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  const plan = await admin
    .from("plans")
    .insert({ key: `qpdf-${run}`, name: "QPDF", monthly_price_pence: 1000 })
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

  const members: Array<[string, string, string]> = [
    ["staff-a", "a", "staff"],
    ["readonly-a", "a", "read_only"],
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

  const customer = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.a, name: `PDF Customer ${run}` })
    .select("id")
    .single();
  if (customer.error) throw new Error(customer.error.message);
  const custAId = customer.data.id;

  sentQuoteId = await seedSentQuote(orgIds.a, custAId, 1, "sent", tokens.sentA);
  draftQuoteId = await seedSentQuote(orgIds.a, custAId, 2, "draft", tokens.draftA);
  deletableQuoteId = await seedSentQuote(
    orgIds.a,
    custAId,
    3,
    "sent",
    tokens.deletableA
  );
  manyQuoteId = await seedManyLineQuote(orgIds.a, custAId, 4, tokens.manyA);

  // Organisation B: a different tenant with its own sent quote and token, to
  // prove a token yields only its own organisation's quote on the public
  // path. No plan needed; the public surface is service-role and token-only.
  const orgB = await admin
    .from("organisations")
    .insert({ name: `Other PDF Co ${run}`, slug: `qpdf-b-${run}` })
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
  await seedSentQuote(orgIds.b, custB.data.id, 1, "sent", tokens.sentB);
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

test("public PDF downloads for a sent quote by its token", async ({
  request,
}) => {
  // No session: the unauthenticated request fixture, the token is the key.
  const response = await request.get(`/q/${tokens.sentA}/pdf`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  expect(response.headers()["content-disposition"]).toContain(
    'attachment; filename="Quote-1.pdf"'
  );

  const body = await response.body();
  expect(body.length).toBeGreaterThan(0);
  expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // The PDF's own text carries the quote number and the total, and that
  // total is exactly the database total run through formatPence.
  const text = extractPdfText(body);
  const total = formatPence(await dbTotal(sentQuoteId));
  expect(text).toContain("#1");
  expect(text).toContain(total);
  expect(total).toBe("£1,969.64");
});

test("draft, unknown and deleted tokens 404 with no PDF", async ({
  request,
}) => {
  // A draft quote, even with a token, is not a public status.
  const draft = await request.get(`/q/${tokens.draftA}/pdf`);
  expect(draft.status()).toBe(404);
  expect(draft.headers()["content-type"]).not.toContain("application/pdf");
  expect((await draft.body()).subarray(0, 5).toString("latin1")).not.toBe(
    "%PDF-"
  );

  // Unknown token (well-formed but no row).
  const unknown = await request.get(`/q/${"x".repeat(43)}/pdf`);
  expect(unknown.status()).toBe(404);

  // Malformed token (fails the format guard).
  const malformed = await request.get(`/q/short/pdf`);
  expect(malformed.status()).toBe(404);

  // A soft-deleted quote's token 404s too.
  const before = await request.get(`/q/${tokens.deletableA}/pdf`);
  expect(before.status()).toBe(200);
  await admin
    .from("quotes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", deletableQuoteId);
  const after = await request.get(`/q/${tokens.deletableA}/pdf`);
  expect(after.status()).toBe(404);
  expect((await after.body()).subarray(0, 5).toString("latin1")).not.toBe(
    "%PDF-"
  );
});

test("a token yields only its own organisation's quote", async ({
  request,
}) => {
  const response = await request.get(`/q/${tokens.sentB}/pdf`);
  expect(response.status()).toBe(200);
  const text = extractPdfText(await response.body());
  expect(text).toContain(`Other PDF Co ${run}`);
  expect(text).not.toContain(`PDF Quotes a ${run}`);
});

test("the in-app download works for a write role", async ({ page }) => {
  await signIn(page, "staff-a");
  const response = await page.request.get(
    `/app/${slugA}/quotes/${sentQuoteId}/pdf`
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  expect(response.headers()["content-disposition"]).toContain(
    'attachment; filename="Quote-1.pdf"'
  );
  const text = extractPdfText(await response.body());
  expect(text).toContain("#1");
  expect(text).toContain(formatPence(await dbTotal(sentQuoteId)));

  // The detail page shows the control for a sent quote.
  await page.goto(`/app/${slugA}/quotes/${sentQuoteId}`);
  await expect(
    page.getByRole("link", { name: "Download PDF" })
  ).toBeVisible();
});

test("the in-app download works for a read-only role", async ({ page }) => {
  await signIn(page, "readonly-a");
  const response = await page.request.get(
    `/app/${slugA}/quotes/${sentQuoteId}/pdf`
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  expect((await response.body()).subarray(0, 5).toString("latin1")).toBe(
    "%PDF-"
  );
});

test("the in-app download is a 404 before a quote is sent", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  const response = await page.request.get(
    `/app/${slugA}/quotes/${draftQuoteId}/pdf`
  );
  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).not.toContain("application/pdf");
});

test("the in-app download is denied without the quotes entitlement", async ({
  page,
}) => {
  await signIn(page, "admin-n");
  const response = await page.request.get(
    `/app/${slugN}/quotes/${crypto.randomUUID()}/pdf`
  );
  expect(response.status()).toBe(403);
  expect(response.headers()["content-type"]).not.toContain("application/pdf");
});

test("a many-line quote paginates with no line dropped across the break", async ({
  request,
}) => {
  const response = await request.get(`/q/${tokens.manyA}/pdf`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");

  const body = await response.body();
  expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // A genuine multi-page document.
  expect(countPdfPages(body)).toBeGreaterThanOrEqual(2);

  // Every line item's description survives, including those that fall across
  // the page break, so nothing is dropped or swallowed by pagination.
  const text = extractPdfText(body);
  for (let i = 1; i <= MANY_LINES; i++) {
    expect(text).toContain(manyDescription(i));
  }

  // The overall total is still the database total formatted by formatPence.
  expect(text).toContain(formatPence(await dbTotal(manyQuoteId)));
});
