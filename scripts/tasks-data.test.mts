// Tasks data-layer test for Phase 6, Pass 6A. Runs against the local Supabase
// stack with:
// npm run test:tasks-data
//
// Proves: tenant isolation (organisation A sees none of organisation B's
// tasks); role-gated writes (read_only denied, staff allowed, both verified by
// service-role re-reads); the status CHECK rejects an invalid status and the
// non-status 'overdue'; the polymorphic-pair CHECK rejects a half-set link
// (type without id, id without type) yet accepts both-null and both-set; and
// that overdue is correctly derivable by query (a past due_at while open is
// overdue, and the same task once done or cancelled is not). Cleans up after
// itself; touches no other table.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  console.error(
    "Missing Supabase env vars. Run via: npm run test:tasks-data (reads .env.local)"
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
    .insert({ name: `Tasks Org ${label} ${run}`, slug: `tasks-${label}-${run}` })
    .select("id")
    .single();
  if (error) fatal(`create org ${label}`, error.message);
  return data.id as string;
}

async function createMember(label: string, orgId: string, role: string) {
  const email = `${label}-${run}@tasks-data.test`;
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

async function seedTask(
  orgId: string,
  fields: Record<string, unknown> = {}
) {
  const { data, error } = await admin
    .from("tasks")
    .insert({ organisation_id: orgId, title: "Seed task", ...fields })
    .select("id")
    .single();
  if (error) fatal(`seed task in ${orgId}`, error.message);
  return data.id as string;
}

async function countById(client: SupabaseClient, table: string, id: string) {
  const { data } = await client.from(table).select("id").eq("id", id);
  return data?.length ?? 0;
}

const HOUR = 60 * 60 * 1000;

// Setup.
const orgA = await createOrg("a");
const orgB = await createOrg("b");

const readOnlyA = await createMember("readonly-a", orgA, "read_only");
const staffA = await createMember("staff-a", orgA, "staff");
const staffB = await createMember("staff-b", orgB, "staff");

const taskA = await seedTask(orgA, { title: "Task A" });
const taskB = await seedTask(orgB, { title: "Task B" });

try {
  // 1. Tenant isolation.
  const tasksA = await staffA.client.from("tasks").select("organisation_id");
  check(
    "staff of A reads only A's tasks",
    tasksA.error === null &&
      (tasksA.data?.length ?? 0) >= 1 &&
      tasksA.data!.every((row) => row.organisation_id === orgA),
    tasksA.error?.message ?? JSON.stringify(tasksA.data)
  );
  check(
    "staff of A cannot see B's task",
    (await countById(staffA.client, "tasks", taskB)) === 0,
    "task B leaked to A"
  );
  check(
    "staff of B cannot see A's task",
    (await countById(staffB.client, "tasks", taskA)) === 0,
    "task A leaked to B"
  );

  // 2. Role-gated writes, verified through the service role.
  check(
    "read_only can read tasks",
    (await countById(readOnlyA.client, "tasks", taskA)) === 1,
    "read_only could not read"
  );
  const roInsert = await readOnlyA.client
    .from("tasks")
    .insert({ organisation_id: orgA, title: "RO task" });
  check("read_only task insert is rejected", roInsert.error !== null, "succeeded");
  await readOnlyA.client
    .from("tasks")
    .update({ title: "RO edit" })
    .eq("id", taskA);
  const roUpdated = await admin
    .from("tasks")
    .select("title")
    .eq("id", taskA)
    .single();
  check(
    "read_only task update changes nothing",
    roUpdated.data?.title === "Task A",
    `title is now ${roUpdated.data?.title}`
  );

  const staffInsert = await staffA.client
    .from("tasks")
    .insert({ organisation_id: orgA, title: "Staff task" })
    .select("id")
    .single();
  check(
    "staff task insert succeeds (service-role re-read)",
    staffInsert.error === null &&
      (await admin
        .from("tasks")
        .select("id")
        .eq("id", staffInsert.data?.id ?? "")
        .maybeSingle()).data !== null,
    staffInsert.error?.message ?? "row not found"
  );

  // 3. Status CHECK: invalid statuses, including 'overdue', are rejected.
  const badStatus = await admin
    .from("tasks")
    .insert({ organisation_id: orgA, title: "Bad status", status: "nope" });
  check(
    "an invalid status is rejected by the CHECK",
    badStatus.error !== null,
    "invalid status accepted"
  );
  const overdueStatus = await admin
    .from("tasks")
    .insert({ organisation_id: orgA, title: "Overdue status", status: "overdue" });
  check(
    "'overdue' is not a valid stored status",
    overdueStatus.error !== null,
    "'overdue' accepted as a status"
  );
  for (const status of ["open", "in_progress", "done", "cancelled"]) {
    const ok = await admin
      .from("tasks")
      .insert({ organisation_id: orgA, title: `Status ${status}`, status });
    check(`status '${status}' is accepted`, ok.error === null, ok.error?.message ?? "");
  }

  // 4. Polymorphic-pair CHECK: both set or both null, never half.
  const typeOnly = await admin.from("tasks").insert({
    organisation_id: orgA,
    title: "Type only",
    related_type: "lead",
  });
  check(
    "a related_type without related_id is rejected",
    typeOnly.error !== null,
    "half-set (type only) accepted"
  );
  const idOnly = await admin.from("tasks").insert({
    organisation_id: orgA,
    title: "Id only",
    related_id: crypto.randomUUID(),
  });
  check(
    "a related_id without related_type is rejected",
    idOnly.error !== null,
    "half-set (id only) accepted"
  );
  const badType = await admin.from("tasks").insert({
    organisation_id: orgA,
    title: "Bad type",
    related_type: "invoice",
    related_id: crypto.randomUUID(),
  });
  check(
    "an out-of-list related_type is rejected",
    badType.error !== null,
    "unknown related_type accepted"
  );
  const neither = await admin
    .from("tasks")
    .insert({ organisation_id: orgA, title: "No link" });
  check("both-null link is accepted", neither.error === null, neither.error?.message ?? "");
  const both = await admin.from("tasks").insert({
    organisation_id: orgA,
    title: "Linked",
    related_type: "customer",
    related_id: crypto.randomUUID(),
  });
  check(
    "a both-set link is accepted (no FK, integrity is the actions layer's job)",
    both.error === null,
    both.error?.message ?? ""
  );

  // 5. Overdue is derivable by query, never stored. A task past its due_at
  // while open is overdue; once done or cancelled the same task is not.
  const pastDue = new Date(Date.now() - HOUR).toISOString();
  const overdueTask = await seedTask(orgA, {
    title: "Overdue derivation",
    due_at: pastDue,
    status: "open",
  });
  const overdueWhere = (q: ReturnType<SupabaseClient["from"]>) =>
    q.select("id").eq("id", overdueTask).lt("due_at", new Date().toISOString());

  const openOverdue = await overdueWhere(admin.from("tasks"))
    .not("status", "in", "(done,cancelled)");
  check(
    "a past-due open task is derived as overdue",
    (openOverdue.data?.length ?? 0) === 1,
    openOverdue.error?.message ?? "not derived overdue"
  );

  await admin.from("tasks").update({ status: "done" }).eq("id", overdueTask);
  const doneOverdue = await overdueWhere(admin.from("tasks"))
    .not("status", "in", "(done,cancelled)");
  check(
    "the same task once done is not overdue",
    (doneOverdue.data?.length ?? 0) === 0,
    "done task still derived overdue"
  );

  await admin.from("tasks").update({ status: "cancelled" }).eq("id", overdueTask);
  const cancelledOverdue = await overdueWhere(admin.from("tasks"))
    .not("status", "in", "(done,cancelled)");
  check(
    "the same task once cancelled is not overdue",
    (cancelledOverdue.data?.length ?? 0) === 0,
    "cancelled task still derived overdue"
  );

  // A task with no due_at is never overdue.
  const noDue = await seedTask(orgA, { title: "No due date", status: "open" });
  const noDueOverdue = await admin
    .from("tasks")
    .select("id")
    .eq("id", noDue)
    .lt("due_at", new Date().toISOString())
    .not("status", "in", "(done,cancelled)");
  check(
    "a task with no due_at is never overdue",
    (noDueOverdue.data?.length ?? 0) === 0,
    "null due_at derived overdue"
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
console.log("\nAll tasks data-layer assertions passed");
