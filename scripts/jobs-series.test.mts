// Job series data-layer test (Phase 2, recurrence pass). Runs against the local
// Supabase stack with: npm run test:jobs-series
//
// Proves at the database: tenant isolation (organisation A reads none of B's
// series); Class A role-gated writes (read_only denied, staff allowed); the
// frequency, interval and end CHECKs; the tenant-scoped composite foreign keys
// (a series cannot reference another organisation's customer, and a job cannot
// reference another organisation's series); and that deleting a series detaches
// its occurrences (jobs.series_id ON DELETE SET NULL) rather than removing them.
// Cleans up after itself.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  console.error(
    "Missing Supabase env vars. Run via: npm run test:jobs-series (reads .env.local)"
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
const ANCHOR = "2030-01-07T09:00:00.000Z";

async function createOrg(label: string) {
  const { data, error } = await admin
    .from("organisations")
    .insert({ name: `Series Org ${label} ${run}`, slug: `series-${label}-${run}` })
    .select("id")
    .single();
  if (error) fatal(`create org ${label}`, error.message);
  return data.id as string;
}

async function createMember(label: string, orgId: string, role: string) {
  const email = `${label}-${run}@jobs-series.test`;
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

async function seedSeries(orgId: string, customerId: string, fields: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("job_series")
    .insert({
      organisation_id: orgId,
      frequency: "weekly",
      repeat_interval: 1,
      anchor_start: ANCHOR,
      title: "Seed series",
      customer_id: customerId,
      ...fields,
    })
    .select("id")
    .single();
  if (error) fatal(`seed series in ${orgId}`, error.message);
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
const seriesA = await seedSeries(orgA, custA);
const seriesB = await seedSeries(orgB, custB);

try {
  // 1. Tenant isolation.
  const visibleToA = await staffA.client.from("job_series").select("organisation_id");
  check(
    "staff of A reads only A's series",
    visibleToA.error === null &&
      (visibleToA.data?.length ?? 0) >= 1 &&
      visibleToA.data!.every((row) => row.organisation_id === orgA),
    visibleToA.error?.message ?? JSON.stringify(visibleToA.data)
  );
  check(
    "staff of A cannot see B's series",
    (await countById(staffA.client, "job_series", seriesB)) === 0
  );

  // 2. Class A role-gated writes.
  check(
    "read_only can read series",
    (await countById(readOnlyA.client, "job_series", seriesA)) === 1
  );
  const roInsert = await readOnlyA.client.from("job_series").insert({
    organisation_id: orgA,
    frequency: "weekly",
    repeat_interval: 1,
    anchor_start: ANCHOR,
    title: "RO series",
    customer_id: custA,
  });
  check("read_only series insert is rejected", roInsert.error !== null, "succeeded");
  const staffInsert = await staffA.client
    .from("job_series")
    .insert({
      organisation_id: orgA,
      frequency: "weekly",
      repeat_interval: 1,
      anchor_start: ANCHOR,
      title: "Staff series",
      customer_id: custA,
    })
    .select("id")
    .single();
  check(
    "staff series insert succeeds",
    staffInsert.error === null,
    staffInsert.error?.message ?? ""
  );

  // 3. CHECK constraints.
  const badFreq = await admin.from("job_series").insert({
    organisation_id: orgA,
    frequency: "fortnightly",
    repeat_interval: 1,
    anchor_start: ANCHOR,
    title: "Bad freq",
    customer_id: custA,
  });
  check("an invalid frequency is rejected", badFreq.error !== null);

  const badInterval = await admin.from("job_series").insert({
    organisation_id: orgA,
    frequency: "weekly",
    repeat_interval: 0,
    anchor_start: ANCHOR,
    title: "Bad interval",
    customer_id: custA,
  });
  check("an interval below 1 is rejected", badInterval.error !== null);

  const bothEnds = await admin.from("job_series").insert({
    organisation_id: orgA,
    frequency: "weekly",
    repeat_interval: 1,
    anchor_start: ANCHOR,
    title: "Both ends",
    customer_id: custA,
    repeat_until: "2030-06-01T00:00:00.000Z",
    max_occurrences: 5,
  });
  check(
    "setting both end kinds is rejected by the end CHECK",
    bothEnds.error !== null
  );

  // 4. Tenant-scoped composite FK: a series cannot reference another org's customer.
  const crossCustomer = await admin.from("job_series").insert({
    organisation_id: orgA,
    frequency: "weekly",
    repeat_interval: 1,
    anchor_start: ANCHOR,
    title: "Cross customer",
    customer_id: custB,
  });
  check(
    "a series referencing another org's customer is rejected by the composite FK",
    crossCustomer.error !== null
  );

  // 5. jobs.series_id composite FK: a job cannot reference another org's series.
  const crossSeries = await admin.from("jobs").insert({
    organisation_id: orgA,
    customer_id: custA,
    title: "Cross series",
    series_id: seriesB,
  });
  check(
    "a job referencing another org's series is rejected by the composite FK",
    crossSeries.error !== null
  );
  const ownSeries = await admin
    .from("jobs")
    .insert({
      organisation_id: orgA,
      customer_id: custA,
      title: "Own series occurrence",
      series_id: seriesA,
      series_slot: ANCHOR,
      scheduled_start: ANCHOR,
      status: "scheduled",
    })
    .select("id")
    .single();
  check(
    "a job referencing its own org's series is accepted",
    ownSeries.error === null,
    ownSeries.error?.message ?? ""
  );

  // 6. Deleting a series detaches its occurrences (ON DELETE SET NULL), not deletes.
  const occId = ownSeries.data?.id as string;
  await admin.from("job_series").delete().eq("id", seriesA);
  const orphan = await admin
    .from("jobs")
    .select("id, series_id")
    .eq("id", occId)
    .maybeSingle();
  check(
    "deleting a series detaches its occurrence (series_id set null, row survives)",
    orphan.data !== null && orphan.data.series_id === null,
    JSON.stringify(orphan.data)
  );
} finally {
  await admin.from("jobs").delete().in("organisation_id", [orgA, orgB]);
  await admin.from("job_series").delete().in("organisation_id", [orgA, orgB]);
  await admin.from("organisations").delete().in("id", [orgA, orgB]);
  for (const { userId } of [readOnlyA, staffA, staffB]) {
    await admin.auth.admin.deleteUser(userId);
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll job series data-layer assertions passed");
