// Multi-tenant isolation test for the Pass 0B spine. Runs against the local
// Supabase stack with: npm run test:rls
//
// Creates two organisations and two real auth users, places each user in one
// organisation only, signs in as each user through the normal session path
// (publishable key plus password, the same path the app will use) and asserts
// that neither user can see or touch the other organisation. Cleans up after
// itself so it is repeatable. Exits non-zero if any assertion fails.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  console.error(
    "Missing Supabase env vars. Run via: npm run test:rls (reads .env.local)"
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
    .insert({ name: `Org ${label} ${run}`, slug: `org-${label}-${run}` })
    .select()
    .single();
  if (error) fatal(`create org ${label}`, error.message);
  return data as { id: string; name: string };
}

async function createUser(label: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `user-${label}-${run}@isolation.test`,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    fatal(`create user ${label}`, error?.message ?? "no user returned");
  }
  return data.user;
}

async function addMembership(orgId: string, userId: string) {
  const { error } = await admin.from("organisation_memberships").insert({
    organisation_id: orgId,
    user_id: userId,
    role: "client_admin",
    status: "active",
  });
  if (error) fatal("add membership", error.message);
}

async function setName(userId: string, fullName: string) {
  const { error } = await admin
    .from("users")
    .update({ full_name: fullName })
    .eq("id", userId);
  if (error) fatal("set name", error.message);
}

async function signIn(email: string) {
  const client = createClient(url!, publishableKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) fatal(`sign in ${email}`, error.message);
  return client;
}

// Runs every isolation assertion for one signed-in user.
async function assertIsolation(
  client: SupabaseClient,
  who: string,
  ownOrg: { id: string; name: string },
  otherOrg: { id: string; name: string },
  ownUserId: string
) {
  const bothIds = [ownOrg.id, otherOrg.id];

  const orgs = await client
    .from("organisations")
    .select("id")
    .in("id", bothIds);
  check(
    `${who} reads own organisation and only that one`,
    orgs.error === null &&
      orgs.data?.length === 1 &&
      orgs.data[0].id === ownOrg.id,
    orgs.error?.message ?? `saw ${orgs.data?.length} organisations`
  );

  const members = await client
    .from("organisation_memberships")
    .select("organisation_id")
    .in("organisation_id", bothIds);
  check(
    `${who} reads own membership rows and only those`,
    members.error === null &&
      (members.data?.length ?? 0) >= 1 &&
      members.data!.every((m) => m.organisation_id === ownOrg.id),
    members.error?.message ?? `saw ${members.data?.length} rows`
  );

  const otherOrgRead = await client
    .from("organisations")
    .select("id")
    .eq("id", otherOrg.id);
  check(
    `${who} reading the other organisation returns nothing`,
    otherOrgRead.error === null && otherOrgRead.data?.length === 0,
    otherOrgRead.error?.message ?? `saw ${otherOrgRead.data?.length} rows`
  );

  const otherMembersRead = await client
    .from("organisation_memberships")
    .select("id")
    .eq("organisation_id", otherOrg.id);
  check(
    `${who} reading the other organisation's memberships returns nothing`,
    otherMembersRead.error === null && otherMembersRead.data?.length === 0,
    otherMembersRead.error?.message ??
      `saw ${otherMembersRead.data?.length} rows`
  );

  const ownUpdate = await client
    .from("organisations")
    .update({ name: `${ownOrg.name} renamed` })
    .eq("id", ownOrg.id)
    .select("id");
  check(
    `${who} (client_admin) can update own organisation name`,
    ownUpdate.error === null && ownUpdate.data?.length === 1,
    ownUpdate.error?.message ?? `updated ${ownUpdate.data?.length} rows`
  );

  const otherUpdate = await client
    .from("organisations")
    .update({ name: "hijacked" })
    .eq("id", otherOrg.id)
    .select("id");
  const untouched = await admin
    .from("organisations")
    .select("name")
    .eq("id", otherOrg.id)
    .single();
  check(
    `${who} updating the other organisation changes nothing`,
    otherUpdate.error === null &&
      otherUpdate.data?.length === 0 &&
      untouched.data?.name !== "hijacked",
    otherUpdate.error?.message ??
      `updated ${otherUpdate.data?.length} rows, name now "${untouched.data?.name}"`
  );

  const otherInsert = await client.from("organisation_memberships").insert({
    organisation_id: otherOrg.id,
    user_id: ownUserId,
    role: "staff",
    status: "active",
  });
  check(
    `${who} inserting a membership into the other organisation is rejected`,
    otherInsert.error !== null,
    "insert unexpectedly succeeded"
  );

  const carveOut = await client
    .from("organisations")
    .update({ next_quote_number: 999 })
    .eq("id", ownOrg.id);
  check(
    `${who} updating a column outside the carve-out is rejected`,
    carveOut.error !== null,
    "update unexpectedly succeeded"
  );
}

// Co-member visibility (added when public.users gained the co-member RLS rule):
// a member can read a co-member's id and name through the normal session, but
// not the row of a user they share no organisation with, and never columns
// beyond the id/full_name/email carve-out.
async function assertCoMemberVisibility(
  client: SupabaseClient,
  who: string,
  coMember: { id: string; name: string },
  stranger: { id: string }
) {
  const read = await client
    .from("users")
    .select("id, full_name")
    .eq("id", coMember.id)
    .maybeSingle();
  check(
    `${who} reads a co-member's id and name`,
    read.error === null &&
      read.data?.id === coMember.id &&
      read.data?.full_name === coMember.name,
    read.error?.message ?? JSON.stringify(read.data)
  );

  const strangerRead = await client
    .from("users")
    .select("id")
    .eq("id", stranger.id);
  check(
    `${who} cannot read a non-co-member's user row`,
    strangerRead.error === null && strangerRead.data?.length === 0,
    strangerRead.error?.message ?? `saw ${strangerRead.data?.length} rows`
  );

  const emailRead = await client
    .from("users")
    .select("email")
    .eq("id", coMember.id)
    .maybeSingle();
  check(
    `${who} can read a co-member's email (the deliberate display fallback)`,
    emailRead.error === null && typeof emailRead.data?.email === "string",
    emailRead.error?.message ?? "email not readable"
  );

  const roleRead = await client
    .from("users")
    .select("platform_role")
    .eq("id", coMember.id);
  check(
    `${who} cannot read a co-member's platform_role (column carve-out)`,
    roleRead.error !== null,
    "platform_role unexpectedly readable"
  );
}

async function cleanup(orgIds: string[], userIds: string[]) {
  await admin.from("organisations").delete().in("id", orgIds);
  for (const id of userIds) {
    await admin.auth.admin.deleteUser(id);
  }
}

const orgA = await createOrg("a");
const orgB = await createOrg("b");
const userA = await createUser("a");
const userB = await createUser("b");
// User C shares organisation A with user A, so they are co-members; user B is
// in organisation B only and shares no organisation with either.
const userC = await createUser("c");
await addMembership(orgA.id, userA.id);
await addMembership(orgB.id, userB.id);
await addMembership(orgA.id, userC.id);
const nameA = `Alice A ${run}`;
const nameC = `Carol C ${run}`;
await setName(userA.id, nameA);
await setName(userC.id, nameC);

try {
  const clientA = await signIn(userA.email!);
  await assertIsolation(clientA, "user A", orgA, orgB, userA.id);
  // A reads co-member C, but not stranger B.
  await assertCoMemberVisibility(
    clientA,
    "user A",
    { id: userC.id, name: nameC },
    { id: userB.id }
  );

  const clientB = await signIn(userB.email!);
  await assertIsolation(clientB, "user B", orgB, orgA, userB.id);
  // B shares no organisation with A or C, so neither row is visible.
  const bReadsOthers = await clientB
    .from("users")
    .select("id")
    .in("id", [userA.id, userC.id]);
  check(
    "user B cannot read user A's or user C's rows (no shared organisation)",
    bReadsOthers.error === null && bReadsOthers.data?.length === 0,
    bReadsOthers.error?.message ?? `saw ${bReadsOthers.data?.length} rows`
  );
  const bSelf = await clientB
    .from("users")
    .select("id")
    .eq("id", userB.id)
    .maybeSingle();
  check(
    "user B still reads its own row",
    bSelf.error === null && bSelf.data?.id === userB.id,
    bSelf.error?.message ?? "self row not readable"
  );
} finally {
  await cleanup([orgA.id, orgB.id], [userA.id, userB.id, userC.id]);
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll isolation assertions passed");
