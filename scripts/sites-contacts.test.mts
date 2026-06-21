// Sites and contacts data-layer test for Pass 5A, mirroring the customers
// test. Runs against the local Supabase stack with:
// npm run test:sites-contacts
//
// Proves, for both tables: tenant isolation; role-gated writes (read_only
// denied, staff allowed, verified by service-role re-reads); the tenant-scoped
// composite foreign key to the customer (same organisation accepted, another
// organisation rejected); and a customer hard-delete cascading to its sites
// and contacts. Additionally: a site soft-deletes (query-layer visibility,
// still tenant-isolated) while a contact hard-deletes (permanent, no
// deleted_at column). Cleans up after itself.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  console.error(
    "Missing Supabase env vars. Run via: npm run test:sites-contacts (reads .env.local)"
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
    .insert({ name: `SC Org ${label} ${run}`, slug: `sc-${label}-${run}` })
    .select("id")
    .single();
  if (error) fatal(`create org ${label}`, error.message);
  return data.id as string;
}

async function createMember(label: string, orgId: string, role: string) {
  const email = `${label}-${run}@sites-contacts.test`;
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

async function seedSite(
  orgId: string,
  customerId: string,
  name: string,
  deletedAt: string | null = null
) {
  const { data, error } = await admin
    .from("sites")
    .insert({
      organisation_id: orgId,
      customer_id: customerId,
      name,
      deleted_at: deletedAt,
    })
    .select("id")
    .single();
  if (error) fatal(`seed site ${name}`, error.message);
  return data.id as string;
}

async function seedContact(orgId: string, customerId: string, name: string) {
  const { data, error } = await admin
    .from("contacts")
    .insert({ organisation_id: orgId, customer_id: customerId, name })
    .select("id")
    .single();
  if (error) fatal(`seed contact ${name}`, error.message);
  return data.id as string;
}

// Setup.
const orgA = await createOrg("a");
const orgB = await createOrg("b");

const readOnlyA = await createMember("readonly-a", orgA, "read_only");
const staffA = await createMember("staff-a", orgA, "staff");
const staffB = await createMember("staff-b", orgB, "staff");

const customerA = await seedCustomer(orgA, "Customer A");
const customerB = await seedCustomer(orgB, "Customer B");
const cascadeCustomer = await seedCustomer(orgA, "Cascade customer A");

const siteA = await seedSite(orgA, customerA, "Active site A");
const deletedSiteA = await seedSite(
  orgA,
  customerA,
  "Deleted site A",
  new Date().toISOString()
);
const siteB = await seedSite(orgB, customerB, "Site B");
const contactA = await seedContact(orgA, customerA, "Contact A");
const contactB = await seedContact(orgB, customerB, "Contact B");

async function countById(client: SupabaseClient, table: string, id: string) {
  const { data } = await client.from(table).select("id").eq("id", id);
  return data?.length ?? 0;
}

try {
  // 1. Tenant isolation on both tables.
  const sitesA = await staffA.client.from("sites").select("organisation_id");
  check(
    "staff of A reads only A's sites",
    sitesA.error === null &&
      (sitesA.data?.length ?? 0) >= 1 &&
      sitesA.data!.every((row) => row.organisation_id === orgA),
    sitesA.error?.message ?? JSON.stringify(sitesA.data)
  );
  check(
    "staff of A cannot see B's site",
    (await countById(staffA.client, "sites", siteB)) === 0,
    "site B leaked to A"
  );

  const contactsA = await staffA.client
    .from("contacts")
    .select("organisation_id");
  check(
    "staff of A reads only A's contacts",
    contactsA.error === null &&
      (contactsA.data?.length ?? 0) >= 1 &&
      contactsA.data!.every((row) => row.organisation_id === orgA),
    contactsA.error?.message ?? JSON.stringify(contactsA.data)
  );
  check(
    "staff of A cannot see B's contact",
    (await countById(staffA.client, "contacts", contactB)) === 0,
    "contact B leaked to A"
  );

  // 2. Role-gated writes, verified through the service role.
  check(
    "read_only can read sites and contacts",
    (await countById(readOnlyA.client, "sites", siteA)) === 1 &&
      (await countById(readOnlyA.client, "contacts", contactA)) === 1,
    "read_only could not read"
  );

  const roSite = await readOnlyA.client
    .from("sites")
    .insert({ organisation_id: orgA, customer_id: customerA, name: "RO site" });
  check("read_only site insert is rejected", roSite.error !== null, "succeeded");
  const roContact = await readOnlyA.client.from("contacts").insert({
    organisation_id: orgA,
    customer_id: customerA,
    name: "RO contact",
  });
  check(
    "read_only contact insert is rejected",
    roContact.error !== null,
    "succeeded"
  );

  const staffSite = await staffA.client
    .from("sites")
    .insert({
      organisation_id: orgA,
      customer_id: customerA,
      name: "Staff site",
    })
    .select("id")
    .single();
  check(
    "staff site insert succeeds (service-role re-read)",
    staffSite.error === null &&
      (await admin
        .from("sites")
        .select("id")
        .eq("id", staffSite.data?.id ?? "")
        .maybeSingle()).data !== null,
    staffSite.error?.message ?? "row not found"
  );
  const staffContact = await staffA.client
    .from("contacts")
    .insert({
      organisation_id: orgA,
      customer_id: customerA,
      name: "Staff contact",
    })
    .select("id")
    .single();
  check(
    "staff contact insert succeeds (service-role re-read)",
    staffContact.error === null &&
      (await admin
        .from("contacts")
        .select("id")
        .eq("id", staffContact.data?.id ?? "")
        .maybeSingle()).data !== null,
    staffContact.error?.message ?? "row not found"
  );

  // 3. Site soft-delete: query-layer visibility, tenancy still enforced.
  const activeSites = await staffA.client
    .from("sites")
    .select("id")
    .eq("organisation_id", orgA)
    .eq("customer_id", customerA)
    .is("deleted_at", null);
  check(
    "an active read excludes the soft-deleted site",
    activeSites.error === null &&
      activeSites.data!.some((r) => r.id === siteA) &&
      activeSites.data!.every((r) => r.id !== deletedSiteA),
    activeSites.error?.message ?? JSON.stringify(activeSites.data)
  );
  const deletedSites = await staffA.client
    .from("sites")
    .select("id")
    .eq("organisation_id", orgA)
    .not("deleted_at", "is", null);
  check(
    "a deleted read includes the soft-deleted site",
    deletedSites.error === null &&
      deletedSites.data!.length === 1 &&
      deletedSites.data![0].id === deletedSiteA,
    deletedSites.error?.message ?? JSON.stringify(deletedSites.data)
  );
  check(
    "organisation B cannot see A's soft-deleted site",
    (await countById(staffB.client, "sites", deletedSiteA)) === 0,
    "soft-deleted site leaked to B"
  );

  // 4. Contact hard-delete: removal is permanent, and there is no deleted_at.
  const tempContact = await seedContact(orgA, customerA, "Temp contact");
  await staffA.client.from("contacts").delete().eq("id", tempContact);
  check(
    "a contact hard-deletes (permanent, service-role re-read)",
    (await countById(admin, "contacts", tempContact)) === 0,
    "contact still present after delete"
  );
  const contactsDeletedAt = await admin
    .from("contacts")
    .select("deleted_at")
    .limit(1);
  check(
    "contacts has no deleted_at column",
    contactsDeletedAt.error !== null,
    "deleted_at unexpectedly selectable"
  );

  // 5. Tenant-scoped composite FK (service role, so the constraint is tested,
  // not RLS).
  const siteSameOrg = await admin
    .from("sites")
    .insert({ organisation_id: orgA, customer_id: customerA, name: "FK ok" });
  check(
    "a site may reference a customer in its own organisation",
    siteSameOrg.error === null,
    siteSameOrg.error?.message ?? ""
  );
  const siteCrossOrg = await admin
    .from("sites")
    .insert({ organisation_id: orgA, customer_id: customerB, name: "FK cross" });
  check(
    "a site referencing another organisation's customer is rejected",
    siteCrossOrg.error !== null,
    "cross-tenant site insert succeeded"
  );
  const contactSameOrg = await admin
    .from("contacts")
    .insert({ organisation_id: orgA, customer_id: customerA, name: "FK ok" });
  check(
    "a contact may reference a customer in its own organisation",
    contactSameOrg.error === null,
    contactSameOrg.error?.message ?? ""
  );
  const contactCrossOrg = await admin
    .from("contacts")
    .insert({ organisation_id: orgA, customer_id: customerB, name: "FK cross" });
  check(
    "a contact referencing another organisation's customer is rejected",
    contactCrossOrg.error !== null,
    "cross-tenant contact insert succeeded"
  );

  // 6. Cascade: hard-deleting a customer removes its sites and contacts.
  const cascadeSite = await seedSite(orgA, cascadeCustomer, "Cascade site");
  const cascadeContact = await seedContact(
    orgA,
    cascadeCustomer,
    "Cascade contact"
  );
  const del = await admin.from("customers").delete().eq("id", cascadeCustomer);
  check(
    "hard-deleting a customer removes its sites and contacts",
    del.error === null &&
      (await countById(admin, "sites", cascadeSite)) === 0 &&
      (await countById(admin, "contacts", cascadeContact)) === 0,
    del.error?.message ?? "child rows survived"
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
console.log("\nAll sites and contacts assertions passed");
