// Quotes data-layer test for Pass 3A. Runs against the local Supabase stack
// with: npm run test:quotes
//
// Proves tenant isolation on quotes and line items, role-gated writes
// (service-role re-reads), quote soft delete, the tenant-scoped composite
// FKs, the database-maintained totals through every kind of line change,
// and the cascade and restrict delete rules. Cleans up after itself.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  console.error(
    "Missing Supabase env vars. Run via: npm run test:quotes (reads .env.local)"
  );
  process.exit(1);
}

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${detail})`}`);
  if (!ok) failures += 1;
}

function fatal(step: string, message: string): never {
  console.error(`SETUP FAILED at ${step}: ${message}`);
  process.exit(1);
}

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;

async function createOrg(label: string) {
  const { data, error } = await admin
    .from("organisations")
    .insert({ name: `Quotes Org ${label} ${run}`, slug: `q-${label}-${run}` })
    .select("id")
    .single();
  if (error) fatal(`create org ${label}`, error.message);
  return data.id as string;
}

async function createMember(label: string, orgId: string, role: string) {
  const email = `${label}-${run}@quotes.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) fatal(`create user ${label}`, error?.message ?? "");
  const membership = await admin.from("organisation_memberships").insert({
    organisation_id: orgId,
    user_id: data.user.id,
    role,
    status: "active",
  });
  if (membership.error) fatal(`membership ${label}`, membership.error.message);
  const client = createClient(url!, publishableKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) fatal(`sign in ${label}`, signIn.error.message);
  return { client, userId: data.user.id };
}

async function seedCustomer(orgId: string, name: string) {
  const { data, error } = await admin
    .from("customers")
    .insert({ organisation_id: orgId, name })
    .select("id")
    .single();
  if (error) fatal(`seed customer ${name}`, error.message);
  return data.id as string;
}

async function seedQuote(
  orgId: string,
  customerId: string,
  quoteNumber: number,
  deletedAt: string | null = null
) {
  const { data, error } = await admin
    .from("quotes")
    .insert({
      organisation_id: orgId,
      customer_id: customerId,
      quote_number: quoteNumber,
      title: `Quote ${quoteNumber}`,
      deleted_at: deletedAt,
    })
    .select("id")
    .single();
  if (error) fatal(`seed quote ${quoteNumber}`, error.message);
  return data.id as string;
}

async function quoteTotals(quoteId: string) {
  const { data, error } = await admin
    .from("quotes")
    .select("subtotal_pence, vat_pence, total_pence")
    .eq("id", quoteId)
    .single();
  if (error) fatal("read totals", error.message);
  return data as {
    subtotal_pence: number;
    vat_pence: number;
    total_pence: number;
  };
}

function totalsEqual(
  actual: { subtotal_pence: number; vat_pence: number; total_pence: number },
  sub: number,
  vat: number
) {
  return (
    actual.subtotal_pence === sub &&
    actual.vat_pence === vat &&
    actual.total_pence === sub + vat
  );
}

// Setup.
const orgA = await createOrg("a");
const orgB = await createOrg("b");
const readOnlyA = await createMember("readonly-a", orgA, "read_only");
const staffA = await createMember("staff-a", orgA, "staff");
const staffB = await createMember("staff-b", orgB, "staff");
const custA = await seedCustomer(orgA, "Customer A");
const custB = await seedCustomer(orgB, "Customer B");
const quoteA = await seedQuote(orgA, custA, 1);
const quoteB = await seedQuote(orgB, custB, 1);
const deletedQuoteA = await seedQuote(orgA, custA, 2, new Date().toISOString());
const lineB = await admin.from("quote_line_items").insert({
  organisation_id: orgB,
  quote_id: quoteB,
  position: 1,
  description: "Org B line",
  quantity: 1,
  unit_price_pence: 1000,
});
if (lineB.error) fatal("seed line B", lineB.error.message);

async function countRows(
  client: SupabaseClient,
  table: string,
  column: string,
  value: string
) {
  const { data } = await client.from(table).select("id").eq(column, value);
  return data?.length ?? 0;
}

try {
  // 1. Tenant isolation on both tables.
  const quotesSeen = await staffA.client
    .from("quotes")
    .select("organisation_id");
  check(
    "staff member of A reads only A's quotes",
    quotesSeen.error === null &&
      (quotesSeen.data?.length ?? 0) >= 2 &&
      quotesSeen.data!.every((row) => row.organisation_id === orgA),
    quotesSeen.error?.message ?? JSON.stringify(quotesSeen.data)
  );
  check(
    "staff member of A cannot see B's quote",
    (await countRows(staffA.client, "quotes", "id", quoteB)) === 0,
    "quote B visible"
  );
  check(
    "staff member of A cannot see B's line items",
    (await countRows(staffA.client, "quote_line_items", "quote_id", quoteB)) ===
      0,
    "line items of B visible"
  );

  // 2. Role-gated writes, verified through the service role.
  const roQuote = await readOnlyA.client.from("quotes").insert({
    organisation_id: orgA,
    customer_id: custA,
    quote_number: 90,
  });
  check(
    "read_only cannot insert a quote",
    roQuote.error !== null,
    "insert unexpectedly succeeded"
  );
  await readOnlyA.client
    .from("quotes")
    .update({ status: "sent" })
    .eq("id", quoteA);
  const afterRoUpdate = await admin
    .from("quotes")
    .select("status")
    .eq("id", quoteA)
    .single();
  check(
    "read_only update changes nothing (service-role re-read)",
    afterRoUpdate.data?.status === "draft",
    `status is ${afterRoUpdate.data?.status}`
  );
  const roLine = await readOnlyA.client.from("quote_line_items").insert({
    organisation_id: orgA,
    quote_id: quoteA,
    position: 1,
    description: "Read-only line",
    unit_price_pence: 100,
  });
  check(
    "read_only cannot insert a line item",
    roLine.error !== null,
    "insert unexpectedly succeeded"
  );

  const staffQuote = await staffA.client
    .from("quotes")
    .insert({
      organisation_id: orgA,
      customer_id: custA,
      quote_number: 3,
      title: "Staff quote",
    })
    .select("id")
    .single();
  const staffQuoteSeen = await admin
    .from("quotes")
    .select("id")
    .eq("id", staffQuote.data?.id ?? "00000000-0000-0000-0000-000000000000");
  check(
    "staff can insert a quote (service-role re-read)",
    staffQuote.error === null && staffQuoteSeen.data?.length === 1,
    staffQuote.error?.message ?? "row not found"
  );
  const staffLine = await staffA.client.from("quote_line_items").insert({
    organisation_id: orgA,
    quote_id: staffQuote.data!.id,
    position: 1,
    description: "Staff line",
    quantity: 1,
    unit_price_pence: 500,
  });
  check(
    "staff can insert a line item",
    staffLine.error === null,
    staffLine.error?.message ?? ""
  );

  // 3. Quote soft delete.
  const activeOnly = await staffA.client
    .from("quotes")
    .select("id")
    .eq("organisation_id", orgA)
    .is("deleted_at", null);
  check(
    "active read excludes the soft-deleted quote",
    activeOnly.error === null &&
      activeOnly.data!.every((row) => row.id !== deletedQuoteA),
    JSON.stringify(activeOnly.data)
  );
  const deletedOnly = await staffA.client
    .from("quotes")
    .select("id")
    .eq("organisation_id", orgA)
    .not("deleted_at", "is", null);
  check(
    "deleted read includes the soft-deleted quote",
    deletedOnly.error === null &&
      deletedOnly.data?.length === 1 &&
      deletedOnly.data![0].id === deletedQuoteA,
    JSON.stringify(deletedOnly.data)
  );
  check(
    "organisation B cannot see A's soft-deleted quote",
    (await countRows(staffB.client, "quotes", "id", deletedQuoteA)) === 0,
    "soft-deleted quote leaked to B"
  );

  // 4. Tenant-scoped composite FKs (service role, the constraint itself).
  const crossQuote = await admin.from("quotes").insert({
    organisation_id: orgA,
    customer_id: custB,
    quote_number: 91,
  });
  check(
    "a quote referencing another organisation's customer is rejected",
    crossQuote.error !== null,
    "cross-tenant quote insert unexpectedly succeeded"
  );
  const crossLine = await admin.from("quote_line_items").insert({
    organisation_id: orgA,
    quote_id: quoteB,
    position: 1,
    description: "Cross-tenant line",
    unit_price_pence: 100,
  });
  check(
    "a line item referencing another organisation's quote is rejected",
    crossLine.error !== null,
    "cross-tenant line insert unexpectedly succeeded"
  );

  // 5. Database-maintained totals through every kind of change.
  const totalsQuote = await seedQuote(orgA, custA, 4);
  check(
    "a quote with no lines has zero totals",
    totalsEqual(await quoteTotals(totalsQuote), 0, 0),
    JSON.stringify(await quoteTotals(totalsQuote))
  );

  // Line 1: 2.00 x 1999 = 3998 net; VAT 20% = 799.6 -> 800.
  const line1 = await admin
    .from("quote_line_items")
    .insert({
      organisation_id: orgA,
      quote_id: totalsQuote,
      position: 1,
      description: "Crane hire",
      quantity: 2,
      unit_price_pence: 1999,
      vat_rate: 20,
    })
    .select("id, line_total_pence")
    .single();
  if (line1.error) fatal("insert line 1", line1.error.message);
  check(
    "line_total_pence is computed automatically",
    line1.data.line_total_pence === 3998,
    `line total is ${line1.data.line_total_pence}`
  );
  check(
    "inserting a line sets subtotal, VAT and total",
    totalsEqual(await quoteTotals(totalsQuote), 3998, 800),
    JSON.stringify(await quoteTotals(totalsQuote))
  );

  // Line 2: 1.50 x 333 = 499.5 -> 500 net; VAT 5% = 25. Mixed rates.
  const line2 = await admin
    .from("quote_line_items")
    .insert({
      organisation_id: orgA,
      quote_id: totalsQuote,
      position: 2,
      description: "Reduced-rate item",
      quantity: 1.5,
      unit_price_pence: 333,
      vat_rate: 5,
    })
    .select("id, line_total_pence")
    .single();
  if (line2.error) fatal("insert line 2", line2.error.message);
  check(
    "fractional quantities round to the nearest penny",
    line2.data.line_total_pence === 500,
    `line total is ${line2.data.line_total_pence}`
  );
  check(
    "mixed VAT rates total correctly (per-line rounding)",
    totalsEqual(await quoteTotals(totalsQuote), 4498, 825),
    JSON.stringify(await quoteTotals(totalsQuote))
  );

  // Quantity change: line 1 -> 3.00 x 1999 = 5997; VAT 1199.4 -> 1199.
  await admin
    .from("quote_line_items")
    .update({ quantity: 3 })
    .eq("id", line1.data.id);
  check(
    "changing a quantity updates the totals",
    totalsEqual(await quoteTotals(totalsQuote), 6497, 1224),
    JSON.stringify(await quoteTotals(totalsQuote))
  );

  // Price change: line 2 -> 1.50 x 1000 = 1500; VAT 5% = 75.
  await admin
    .from("quote_line_items")
    .update({ unit_price_pence: 1000 })
    .eq("id", line2.data.id);
  check(
    "changing a unit price updates the totals",
    totalsEqual(await quoteTotals(totalsQuote), 7497, 1274),
    JSON.stringify(await quoteTotals(totalsQuote))
  );

  // VAT rate change: line 2 -> 20% = 300.
  await admin
    .from("quote_line_items")
    .update({ vat_rate: 20 })
    .eq("id", line2.data.id);
  check(
    "changing a VAT rate updates the totals",
    totalsEqual(await quoteTotals(totalsQuote), 7497, 1499),
    JSON.stringify(await quoteTotals(totalsQuote))
  );

  // Delete line 2: back to line 1 alone.
  await admin.from("quote_line_items").delete().eq("id", line2.data.id);
  check(
    "deleting a line updates the totals",
    totalsEqual(await quoteTotals(totalsQuote), 5997, 1199),
    JSON.stringify(await quoteTotals(totalsQuote))
  );

  // 6. Cascade and restrict.
  await admin.from("quotes").delete().eq("id", totalsQuote);
  const orphanLines = await admin
    .from("quote_line_items")
    .select("id")
    .eq("quote_id", totalsQuote);
  check(
    "hard-deleting a quote removes its line items",
    orphanLines.data?.length === 0,
    `${orphanLines.data?.length} lines remain`
  );
  const restricted = await admin.from("customers").delete().eq("id", custA);
  check(
    "hard-deleting a customer with quotes is refused",
    restricted.error !== null,
    "customer delete unexpectedly succeeded"
  );
} finally {
  // Quotes restrict customer deletion, so remove quotes before the
  // organisations cascade everything else away.
  await admin.from("quotes").delete().in("organisation_id", [orgA, orgB]);
  await admin.from("organisations").delete().in("id", [orgA, orgB]);
  for (const { userId } of [readOnlyA, staffA, staffB]) {
    await admin.auth.admin.deleteUser(userId);
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll quotes assertions passed");
