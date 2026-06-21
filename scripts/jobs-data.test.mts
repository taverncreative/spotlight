// Jobs data-layer test for Phase 2, Pass 1. Runs against the local Supabase
// stack with: npm run test:jobs-data
//
// Proves: tenant isolation (organisation A reads none of organisation B's jobs);
// role-gated writes (read_only denied, staff allowed, verified by service-role
// re-reads); the status CHECK rejects an invalid status and accepts the five
// valid ones; the schedule-span CHECK rejects an end without a start and an end
// not after the start; and the tenant-scoped composite foreign keys make a job
// referencing another organisation's customer or site impossible at the database.
// Cleans up after itself.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  console.error(
    "Missing Supabase env vars. Run via: npm run test:jobs-data (reads .env.local)"
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
const HOUR = 60 * 60 * 1000;

async function createOrg(label: string) {
  const { data, error } = await admin
    .from("organisations")
    .insert({ name: `Jobs Org ${label} ${run}`, slug: `jobs-${label}-${run}` })
    .select("id")
    .single();
  if (error) fatal(`create org ${label}`, error.message);
  return data.id as string;
}

async function createMember(label: string, orgId: string, role: string) {
  const email = `${label}-${run}@jobs-data.test`;
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

async function seedCustomer(orgId: string) {
  const { data, error } = await admin
    .from("customers")
    .insert({ organisation_id: orgId, name: `Customer ${run}` })
    .select("id")
    .single();
  if (error) fatal(`seed customer in ${orgId}`, error.message);
  return data.id as string;
}

async function seedSite(orgId: string, customerId: string) {
  const { data, error } = await admin
    .from("sites")
    .insert({ organisation_id: orgId, customer_id: customerId, name: `Site ${run}` })
    .select("id")
    .single();
  if (error) fatal(`seed site in ${orgId}`, error.message);
  return data.id as string;
}

async function seedJob(orgId: string, customerId: string, fields: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("jobs")
    .insert({
      organisation_id: orgId,
      customer_id: customerId,
      title: "Seed job",
      ...fields,
    })
    .select("id")
    .single();
  if (error) fatal(`seed job in ${orgId}`, error.message);
  return data.id as string;
}

async function countById(client: SupabaseClient, table: string, id: string) {
  const { data } = await client.from(table).select("id").eq("id", id);
  return data?.length ?? 0;
}

const orgA = await createOrg("a");
const orgB = await createOrg("b");

const readOnlyA = await createMember("readonly-a", orgA, "read_only");
const staffA = await createMember("staff-a", orgA, "staff");
const staffB = await createMember("staff-b", orgB, "staff");

const custA = await seedCustomer(orgA);
const custB = await seedCustomer(orgB);
const siteA = await seedSite(orgA, custA);
const siteB = await seedSite(orgB, custB);

const jobA = await seedJob(orgA, custA, { title: "Job A" });
const jobB = await seedJob(orgB, custB, { title: "Job B" });

try {
  // 1. Tenant isolation.
  const jobsA = await staffA.client.from("jobs").select("organisation_id");
  check(
    "staff of A reads only A's jobs",
    jobsA.error === null &&
      (jobsA.data?.length ?? 0) >= 1 &&
      jobsA.data!.every((row) => row.organisation_id === orgA),
    jobsA.error?.message ?? JSON.stringify(jobsA.data)
  );
  check(
    "staff of A cannot see B's job",
    (await countById(staffA.client, "jobs", jobB)) === 0,
    "job B leaked to A"
  );
  check(
    "staff of B cannot see A's job",
    (await countById(staffB.client, "jobs", jobA)) === 0,
    "job A leaked to B"
  );

  // 2. Role-gated writes, verified through the service role.
  check(
    "read_only can read jobs",
    (await countById(readOnlyA.client, "jobs", jobA)) === 1,
    "read_only could not read"
  );
  const roInsert = await readOnlyA.client
    .from("jobs")
    .insert({ organisation_id: orgA, customer_id: custA, title: "RO job" });
  check("read_only job insert is rejected", roInsert.error !== null, "succeeded");
  await readOnlyA.client.from("jobs").update({ title: "RO edit" }).eq("id", jobA);
  const roUpdated = await admin
    .from("jobs")
    .select("title")
    .eq("id", jobA)
    .single();
  check(
    "read_only job update changes nothing",
    roUpdated.data?.title === "Job A",
    `title is now ${roUpdated.data?.title}`
  );
  const staffInsert = await staffA.client
    .from("jobs")
    .insert({ organisation_id: orgA, customer_id: custA, title: "Staff job" })
    .select("id")
    .single();
  check(
    "staff job insert succeeds (service-role re-read)",
    staffInsert.error === null &&
      (await admin
        .from("jobs")
        .select("id")
        .eq("id", staffInsert.data?.id ?? "")
        .maybeSingle()).data !== null,
    staffInsert.error?.message ?? "row not found"
  );

  // 3. Status CHECK.
  const badStatus = await admin.from("jobs").insert({
    organisation_id: orgA,
    customer_id: custA,
    title: "Bad status",
    status: "nope",
  });
  check(
    "an invalid status is rejected by the CHECK",
    badStatus.error !== null,
    "invalid status accepted"
  );
  for (const status of [
    "unscheduled",
    "scheduled",
    "in_progress",
    "completed",
    "cancelled",
  ]) {
    const ok = await admin.from("jobs").insert({
      organisation_id: orgA,
      customer_id: custA,
      title: `Status ${status}`,
      status,
    });
    check(`status '${status}' is accepted`, ok.error === null, ok.error?.message ?? "");
  }

  // 4. Schedule-span CHECK: an end needs a start, and must come after it.
  const endNoStart = await admin.from("jobs").insert({
    organisation_id: orgA,
    customer_id: custA,
    title: "End without start",
    scheduled_end: new Date().toISOString(),
  });
  check(
    "a scheduled_end without a scheduled_start is rejected",
    endNoStart.error !== null,
    "end without start accepted"
  );
  const start = new Date();
  const endBeforeStart = await admin.from("jobs").insert({
    organisation_id: orgA,
    customer_id: custA,
    title: "End before start",
    scheduled_start: start.toISOString(),
    scheduled_end: new Date(start.getTime() - HOUR).toISOString(),
  });
  check(
    "a scheduled_end not after the start is rejected",
    endBeforeStart.error !== null,
    "end before start accepted"
  );
  const validSpan = await admin.from("jobs").insert({
    organisation_id: orgA,
    customer_id: custA,
    title: "Valid span",
    scheduled_start: start.toISOString(),
    scheduled_end: new Date(start.getTime() + HOUR).toISOString(),
  });
  check(
    "a start with a later end is accepted",
    validSpan.error === null,
    validSpan.error?.message ?? ""
  );

  // 5. Tenant-scoped composite FKs: a job cannot reference another org's
  // customer or site, even through the service role (which bypasses RLS, not
  // foreign keys).
  const crossCustomer = await admin.from("jobs").insert({
    organisation_id: orgA,
    customer_id: custB,
    title: "Cross-tenant customer",
  });
  check(
    "a job referencing another org's customer is rejected by the composite FK",
    crossCustomer.error !== null,
    "cross-tenant customer accepted"
  );
  const crossSite = await admin.from("jobs").insert({
    organisation_id: orgA,
    customer_id: custA,
    title: "Cross-tenant site",
    site_id: siteB,
  });
  check(
    "a job referencing another org's site is rejected by the composite FK",
    crossSite.error !== null,
    "cross-tenant site accepted"
  );
  const ownSite = await admin.from("jobs").insert({
    organisation_id: orgA,
    customer_id: custA,
    title: "Own site",
    site_id: siteA,
  });
  check(
    "a job referencing its own org's site is accepted",
    ownSite.error === null,
    ownSite.error?.message ?? ""
  );

  // 6. customer_id is required.
  const noCustomer = await admin
    .from("jobs")
    .insert({ organisation_id: orgA, title: "No customer" });
  check(
    "a job without a customer is rejected (NOT NULL)",
    noCustomer.error !== null,
    "job without a customer accepted"
  );
} finally {
  // Jobs reference customers ON DELETE RESTRICT, so clear jobs before the org
  // cascade would try to remove the customers.
  await admin.from("jobs").delete().in("organisation_id", [orgA, orgB]);
  await admin.from("organisations").delete().in("id", [orgA, orgB]);
  for (const { userId } of [readOnlyA, staffA, staffB]) {
    await admin.auth.admin.deleteUser(userId);
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll jobs data-layer assertions passed");
