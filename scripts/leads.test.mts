// Leads table and Class A RLS test for Pass 1A. Runs against the local
// Supabase stack with: npm run test:leads
//
// Seeds two organisations with a leads entitlement via a real assign_plan
// call, a read_only and a staff member in organisation A and a staff member
// in organisation B, then proves tenant isolation, role-gated writes
// (verified by re-reading with the service role, never by trusting an empty
// response) and soft-delete visibility. Cleans up after itself.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  console.error(
    "Missing Supabase env vars. Run via: npm run test:leads (reads .env.local)"
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
      name: `Leads Org ${label} ${run}`,
      slug: `leads-${label}-${run}`,
    })
    .select("id")
    .single();
  if (error) fatal(`create org ${label}`, error.message);
  return data.id as string;
}

async function createMember(label: string, orgId: string, role: string) {
  const email = `${label}-${run}@leads.test`;
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

async function seedLead(
  orgId: string,
  name: string,
  deletedAt: string | null = null
) {
  const { data, error } = await admin
    .from("leads")
    .insert({ organisation_id: orgId, name, deleted_at: deletedAt })
    .select("id")
    .single();
  if (error) fatal(`seed lead ${name}`, error.message);
  return data.id as string;
}

// Setup.
const orgA = await createOrg("a");
const orgB = await createOrg("b");

const plan = await admin
  .from("plans")
  .insert({ key: `leads-${run}`, name: "Leads", monthly_price_pence: 1000 })
  .select("id")
  .single();
if (plan.error) fatal("create plan", plan.error.message);
const planId = plan.data.id as string;
const linked = await admin
  .from("plan_modules")
  .insert({ plan_id: planId, module: "leads" });
if (linked.error) fatal("link module", linked.error.message);
for (const orgId of [orgA, orgB]) {
  const assigned = await admin.rpc("assign_plan", {
    org_id: orgId,
    new_plan_id: planId,
  });
  if (assigned.error) fatal("assign plan", assigned.error.message);
}

const readOnlyA = await createMember("readonly-a", orgA, "read_only");
const staffA = await createMember("staff-a", orgA, "staff");
const staffB = await createMember("staff-b", orgB, "staff");

const activeLeadA = await seedLead(orgA, "Active lead A");
const leadB = await seedLead(orgB, "Lead B");
const deletedLeadA = await seedLead(
  orgA,
  "Deleted lead A",
  new Date().toISOString()
);

async function readLead(client: SupabaseClient, id: string) {
  const { data } = await client.from("leads").select("id").eq("id", id);
  return data?.length ?? 0;
}

try {
  // 1. Tenant isolation on reads.
  const staffARead = await staffA.client
    .from("leads")
    .select("organisation_id");
  check(
    "staff member of A reads only A's leads",
    staffARead.error === null &&
      (staffARead.data?.length ?? 0) >= 2 &&
      staffARead.data!.every((row) => row.organisation_id === orgA),
    staffARead.error?.message ?? JSON.stringify(staffARead.data)
  );
  check(
    "staff member of A reading B's lead sees nothing",
    (await readLead(staffA.client, leadB)) === 0,
    "lead B was visible"
  );

  // 2. Role-gated writes, verified through the service role.
  check(
    "read_only member can read leads",
    (await readLead(readOnlyA.client, activeLeadA)) === 1,
    "could not read"
  );

  const roInsert = await readOnlyA.client
    .from("leads")
    .insert({ organisation_id: orgA, name: "Read-only insert" });
  check(
    "read_only insert is rejected",
    roInsert.error !== null,
    "insert unexpectedly succeeded"
  );

  await readOnlyA.client
    .from("leads")
    .update({ status: "contacted" })
    .eq("id", activeLeadA);
  const afterUpdate = await admin
    .from("leads")
    .select("status")
    .eq("id", activeLeadA)
    .single();
  check(
    "read_only update changes nothing (service-role re-read)",
    afterUpdate.data?.status === "new",
    `status is ${afterUpdate.data?.status}`
  );

  await readOnlyA.client.from("leads").delete().eq("id", activeLeadA);
  const afterDelete = await admin
    .from("leads")
    .select("id")
    .eq("id", activeLeadA);
  check(
    "read_only delete removes nothing (service-role re-read)",
    afterDelete.data?.length === 1,
    "lead was deleted"
  );

  const staffInsert = await staffA.client
    .from("leads")
    .insert({ organisation_id: orgA, name: "Staff insert" })
    .select("id")
    .single();
  const staffInsertSeen = await admin
    .from("leads")
    .select("id")
    .eq("id", staffInsert.data?.id ?? "00000000-0000-0000-0000-000000000000");
  check(
    "staff insert succeeds (service-role re-read)",
    staffInsert.error === null && staffInsertSeen.data?.length === 1,
    staffInsert.error?.message ?? "row not found"
  );

  // 3. Soft delete: query-layer visibility, tenancy still enforced.
  const activeOnly = await staffA.client
    .from("leads")
    .select("id")
    .eq("organisation_id", orgA)
    .is("deleted_at", null);
  check(
    "filtering deleted_at is null excludes the soft-deleted lead",
    activeOnly.error === null &&
      activeOnly.data?.length === 2 &&
      activeOnly.data!.every((row) => row.id !== deletedLeadA),
    activeOnly.error?.message ?? JSON.stringify(activeOnly.data)
  );

  const deletedOnly = await staffA.client
    .from("leads")
    .select("id")
    .eq("organisation_id", orgA)
    .not("deleted_at", "is", null);
  check(
    "asking for deleted rows returns the soft-deleted lead",
    deletedOnly.error === null &&
      deletedOnly.data?.length === 1 &&
      deletedOnly.data![0].id === deletedLeadA,
    deletedOnly.error?.message ?? JSON.stringify(deletedOnly.data)
  );

  check(
    "organisation B cannot see A's soft-deleted lead",
    (await readLead(staffB.client, deletedLeadA)) === 0,
    "soft-deleted lead leaked to B"
  );
} finally {
  await admin.from("audit_log").delete().in("organisation_id", [orgA, orgB]);
  await admin.from("organisations").delete().in("id", [orgA, orgB]);
  await admin.from("plans").delete().eq("id", planId);
  for (const { userId } of [readOnlyA, staffA, staffB]) {
    await admin.auth.admin.deleteUser(userId);
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll leads assertions passed");
