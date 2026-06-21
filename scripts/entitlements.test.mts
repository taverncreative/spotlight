// Entitlement materialisation and access test for Pass 0D. Runs against the
// local Supabase stack with: npm run test:entitlements
//
// Proves that assigning a plan materialises exactly that plan's modules as
// 'plan'-source entitlements, that re-assigning re-materialises them while
// leaving 'add_on' rows untouched, that a client member can read but never
// write entitlements or call assign_plan, and that assignments are audit
// logged where clients cannot see them. Cleans up after itself.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  console.error(
    "Missing Supabase env vars. Run via: npm run test:entitlements (reads .env.local)"
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

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const email = `member-${run}@entitlements.test`;

const CORE_MODULES = ["leads", "customers", "tasks"];
const GROWTH_MODULES = ["leads", "customers", "quotes", "automations"];
const ADD_ON_MODULE = "subscription_savings";

// Setup: one organisation, one client_admin member, two plans, one add-on.
const org = await admin
  .from("organisations")
  .insert({ name: `Entitlement Org ${run}`, slug: `ent-${run}` })
  .select("id")
  .single();
if (org.error) fatal("create org", org.error.message);
const orgId = org.data.id as string;

const user = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (user.error || !user.data.user) {
  fatal("create user", user.error?.message ?? "no user returned");
}
const userId = user.data.user.id;

const membership = await admin.from("organisation_memberships").insert({
  organisation_id: orgId,
  user_id: userId,
  role: "client_admin",
  status: "active",
});
if (membership.error) fatal("add membership", membership.error.message);

async function createPlan(key: string, modules: string[]) {
  const plan = await admin
    .from("plans")
    .insert({ key: `${key}-${run}`, name: key, monthly_price_pence: 10000 })
    .select("id")
    .single();
  if (plan.error) fatal(`create plan ${key}`, plan.error.message);
  const rows = modules.map((module) => ({ plan_id: plan.data.id, module }));
  const linked = await admin.from("plan_modules").insert(rows);
  if (linked.error) fatal(`link modules ${key}`, linked.error.message);
  return plan.data.id as string;
}

const corePlanId = await createPlan("core", CORE_MODULES);
const growthPlanId = await createPlan("growth", GROWTH_MODULES);

const addOn = await admin.from("organisation_entitlements").insert({
  organisation_id: orgId,
  module: ADD_ON_MODULE,
  source: "add_on",
});
if (addOn.error) fatal("seed add-on", addOn.error.message);

async function entitlements() {
  const { data, error } = await admin
    .from("organisation_entitlements")
    .select("module, source")
    .eq("organisation_id", orgId);
  if (error) fatal("read entitlements", error.message);
  return data as { module: string; source: string }[];
}

try {
  // 1. First assignment materialises exactly the plan's modules.
  const first = await admin.rpc("assign_plan", {
    org_id: orgId,
    new_plan_id: corePlanId,
  });
  check(
    "assign_plan (core) succeeds",
    first.error === null,
    first.error?.message
  );

  let rows = await entitlements();
  check(
    "core assignment produces exactly the plan's modules with source 'plan'",
    sameSet(
      rows.filter((r) => r.source === "plan").map((r) => r.module),
      CORE_MODULES
    ),
    JSON.stringify(rows)
  );

  // 2. Re-assignment re-materialises 'plan' rows, leaves the add-on alone.
  const second = await admin.rpc("assign_plan", {
    org_id: orgId,
    new_plan_id: growthPlanId,
  });
  check(
    "assign_plan (growth) succeeds",
    second.error === null,
    second.error?.message
  );

  rows = await entitlements();
  check(
    "growth re-assignment updates 'plan' rows correctly",
    sameSet(
      rows.filter((r) => r.source === "plan").map((r) => r.module),
      GROWTH_MODULES
    ),
    JSON.stringify(rows)
  );
  check(
    "the seeded add-on entitlement is untouched",
    rows.some((r) => r.module === ADD_ON_MODULE && r.source === "add_on"),
    JSON.stringify(rows)
  );

  const orgRow = await admin
    .from("organisations")
    .select("plan_id")
    .eq("id", orgId)
    .single();
  check(
    "organisations.plan_id records the assigned plan",
    orgRow.data?.plan_id === growthPlanId,
    `plan_id is ${orgRow.data?.plan_id}`
  );

  // 3. A client member: reads, but every write path is closed.
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) fatal("sign in", signIn.error.message);

  const memberRead = await client
    .from("organisation_entitlements")
    .select("module, source")
    .eq("organisation_id", orgId);
  check(
    "member reads own organisation's entitlements",
    memberRead.error === null && memberRead.data?.length === 5,
    memberRead.error?.message ?? `saw ${memberRead.data?.length} rows`
  );

  const catalogue = await client
    .from("plans")
    .select("id")
    .in("id", [corePlanId, growthPlanId]);
  check(
    "member reads the plan catalogue",
    catalogue.error === null && catalogue.data?.length === 2,
    catalogue.error?.message ?? `saw ${catalogue.data?.length} plans`
  );

  const memberInsert = await client.from("organisation_entitlements").insert({
    organisation_id: orgId,
    module: "files",
    source: "add_on",
  });
  check(
    "member inserting an entitlement is rejected",
    memberInsert.error !== null,
    "insert unexpectedly succeeded"
  );

  const memberUpdate = await client
    .from("organisation_entitlements")
    .update({ seat_band: "1-100" })
    .eq("organisation_id", orgId)
    .select("id");
  const memberDelete = await client
    .from("organisation_entitlements")
    .delete()
    .eq("organisation_id", orgId)
    .select("id");
  const afterWrites = await entitlements();
  check(
    "member update and delete change nothing",
    memberUpdate.data?.length === 0 &&
      memberDelete.data?.length === 0 &&
      afterWrites.length === 5 &&
      afterWrites.every((r) => r.module !== "files"),
    `update ${memberUpdate.data?.length}, delete ${memberDelete.data?.length}, rows ${afterWrites.length}`
  );

  const memberAssign = await client.rpc("assign_plan", {
    org_id: orgId,
    new_plan_id: corePlanId,
  });
  check(
    "member calling assign_plan is rejected",
    memberAssign.error !== null,
    "rpc unexpectedly succeeded"
  );

  // 4. Audit trail: written for the platform, invisible to clients.
  const audit = await admin
    .from("audit_log")
    .select("action, metadata")
    .eq("organisation_id", orgId)
    .eq("action", "plan.assigned")
    .order("created_at", { ascending: true });
  const last = audit.data?.[audit.data.length - 1]?.metadata as
    | {
        plan_key?: string;
        before_modules?: string[];
        after_modules?: string[];
      }
    | undefined;
  check(
    "both assignments wrote audit_log rows with before and after sets",
    audit.error === null &&
      audit.data?.length === 2 &&
      sameSet(last?.before_modules ?? [], [...CORE_MODULES, ADD_ON_MODULE]) &&
      sameSet(last?.after_modules ?? [], [...GROWTH_MODULES, ADD_ON_MODULE]),
    audit.error?.message ?? JSON.stringify(audit.data)
  );

  const memberAudit = await client.from("audit_log").select("id");
  check(
    "member cannot read audit_log at all",
    memberAudit.error === null && memberAudit.data?.length === 0,
    memberAudit.error?.message ?? `saw ${memberAudit.data?.length} rows`
  );
} finally {
  await admin.from("audit_log").delete().eq("organisation_id", orgId);
  await admin.from("organisations").delete().eq("id", orgId);
  await admin.from("plans").delete().in("id", [corePlanId, growthPlanId]);
  await admin.auth.admin.deleteUser(userId);
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll entitlement assertions passed");
