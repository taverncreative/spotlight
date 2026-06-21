// Customers table and Class A RLS test for Pass 2A, mirroring the leads
// data-layer test. Runs against the local Supabase stack with:
// npm run test:customers
//
// Proves tenant isolation, role-gated writes (verified by service-role
// re-reads), soft-delete visibility, and that the new
// leads.converted_customer_id foreign key is genuinely in place. Cleans up
// after itself.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  console.error(
    "Missing Supabase env vars. Run via: npm run test:customers (reads .env.local)"
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
    .insert({
      name: `Customers Org ${label} ${run}`,
      slug: `cust-${label}-${run}`,
    })
    .select("id")
    .single();
  if (error) fatal(`create org ${label}`, error.message);
  return data.id as string;
}

async function createMember(label: string, orgId: string, role: string) {
  const email = `${label}-${run}@customers.test`;
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

async function seedCustomer(
  orgId: string,
  name: string,
  deletedAt: string | null = null
) {
  const { data, error } = await admin
    .from("customers")
    .insert({ organisation_id: orgId, name, deleted_at: deletedAt })
    .select("id")
    .single();
  if (error) fatal(`seed customer ${name}`, error.message);
  return data.id as string;
}

// Setup.
const orgA = await createOrg("a");
const orgB = await createOrg("b");

const readOnlyA = await createMember("readonly-a", orgA, "read_only");
const staffA = await createMember("staff-a", orgA, "staff");
const staffB = await createMember("staff-b", orgB, "staff");

const activeCustomerA = await seedCustomer(orgA, "Active customer A");
const customerB = await seedCustomer(orgB, "Customer B");
const deletedCustomerA = await seedCustomer(
  orgA,
  "Deleted customer A",
  new Date().toISOString()
);

async function readCustomer(client: SupabaseClient, id: string) {
  const { data } = await client.from("customers").select("id").eq("id", id);
  return data?.length ?? 0;
}

try {
  // 1. Tenant isolation on reads.
  const staffARead = await staffA.client
    .from("customers")
    .select("organisation_id");
  check(
    "staff member of A reads only A's customers",
    staffARead.error === null &&
      (staffARead.data?.length ?? 0) >= 2 &&
      staffARead.data!.every((row) => row.organisation_id === orgA),
    staffARead.error?.message ?? JSON.stringify(staffARead.data)
  );
  check(
    "staff member of A reading B's customer sees nothing",
    (await readCustomer(staffA.client, customerB)) === 0,
    "customer B was visible"
  );

  // 2. Role-gated writes, verified through the service role.
  check(
    "read_only member can read customers",
    (await readCustomer(readOnlyA.client, activeCustomerA)) === 1,
    "could not read"
  );

  const roInsert = await readOnlyA.client
    .from("customers")
    .insert({ organisation_id: orgA, name: "Read-only insert" });
  check(
    "read_only insert is rejected",
    roInsert.error !== null,
    "insert unexpectedly succeeded"
  );

  await readOnlyA.client
    .from("customers")
    .update({ type: "individual" })
    .eq("id", activeCustomerA);
  const afterUpdate = await admin
    .from("customers")
    .select("type")
    .eq("id", activeCustomerA)
    .single();
  check(
    "read_only update changes nothing (service-role re-read)",
    afterUpdate.data?.type === "business",
    `type is ${afterUpdate.data?.type}`
  );

  await readOnlyA.client.from("customers").delete().eq("id", activeCustomerA);
  const afterDelete = await admin
    .from("customers")
    .select("id")
    .eq("id", activeCustomerA);
  check(
    "read_only delete removes nothing (service-role re-read)",
    afterDelete.data?.length === 1,
    "customer was deleted"
  );

  const staffInsert = await staffA.client
    .from("customers")
    .insert({ organisation_id: orgA, name: "Staff insert" })
    .select("id")
    .single();
  const staffInsertSeen = await admin
    .from("customers")
    .select("id")
    .eq("id", staffInsert.data?.id ?? "00000000-0000-0000-0000-000000000000");
  check(
    "staff insert succeeds (service-role re-read)",
    staffInsert.error === null && staffInsertSeen.data?.length === 1,
    staffInsert.error?.message ?? "row not found"
  );

  // 3. Soft delete: query-layer visibility, tenancy still enforced.
  const activeOnly = await staffA.client
    .from("customers")
    .select("id")
    .eq("organisation_id", orgA)
    .is("deleted_at", null);
  check(
    "filtering deleted_at is null excludes the soft-deleted customer",
    activeOnly.error === null &&
      activeOnly.data?.length === 2 &&
      activeOnly.data!.every((row) => row.id !== deletedCustomerA),
    activeOnly.error?.message ?? JSON.stringify(activeOnly.data)
  );

  const deletedOnly = await staffA.client
    .from("customers")
    .select("id")
    .eq("organisation_id", orgA)
    .not("deleted_at", "is", null);
  check(
    "asking for deleted rows returns the soft-deleted customer",
    deletedOnly.error === null &&
      deletedOnly.data?.length === 1 &&
      deletedOnly.data![0].id === deletedCustomerA,
    deletedOnly.error?.message ?? JSON.stringify(deletedOnly.data)
  );

  check(
    "organisation B cannot see A's soft-deleted customer",
    (await readCustomer(staffB.client, deletedCustomerA)) === 0,
    "soft-deleted customer leaked to B"
  );

  // 4. The tenant-scoped conversion foreign key. These run with the service
  // role, so the database constraint itself is under test, not RLS.
  const linkedLead = await admin
    .from("leads")
    .insert({
      organisation_id: orgA,
      name: "Converted lead",
      status: "converted",
      converted_customer_id: activeCustomerA,
    })
    .select("id")
    .single();
  check(
    "a lead can reference a customer in the same organisation",
    linkedLead.error === null,
    linkedLead.error?.message ?? ""
  );

  const crossTenantLead = await admin.from("leads").insert({
    organisation_id: orgA,
    name: "Cross-tenant lead",
    converted_customer_id: customerB,
  });
  check(
    "a lead referencing another organisation's customer is rejected",
    crossTenantLead.error !== null,
    "cross-tenant insert unexpectedly succeeded"
  );

  const unconvertedLead = await admin
    .from("leads")
    .insert({ organisation_id: orgA, name: "Unconverted lead" })
    .select("id")
    .single();
  check(
    "an unconverted lead with a null link is still valid",
    unconvertedLead.error === null,
    unconvertedLead.error?.message ?? ""
  );

  const danglingLead = await admin.from("leads").insert({
    organisation_id: orgA,
    name: "Dangling lead",
    converted_customer_id: crypto.randomUUID(),
  });
  check(
    "a lead referencing a customer that does not exist is rejected",
    danglingLead.error !== null,
    "insert unexpectedly succeeded"
  );

  // Hard-deleting the customer clears only the link; the lead's
  // organisation_id is untouched.
  const hardDelete = await admin
    .from("customers")
    .delete()
    .eq("id", activeCustomerA);
  const leadAfter = await admin
    .from("leads")
    .select("converted_customer_id, organisation_id")
    .eq("id", linkedLead.data?.id ?? "")
    .single();
  check(
    "hard-deleting the customer nulls the link and leaves organisation_id intact",
    hardDelete.error === null &&
      leadAfter.data?.converted_customer_id === null &&
      leadAfter.data?.organisation_id === orgA,
    hardDelete.error?.message ??
      `link ${leadAfter.data?.converted_customer_id}, org ${leadAfter.data?.organisation_id}`
  );
} finally {
  await admin.from("organisations").delete().in("id", [orgA, orgB]);
  for (const { userId } of [readOnlyA, staffA, staffB]) {
    await admin.auth.admin.deleteUser(userId);
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll customers assertions passed");
