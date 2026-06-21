// Files storage isolation and write-role proof. Runs against the local
// Supabase stack with: npm run test:files-storage
//
// This is the centrepiece of the storage foundation. It proves two things with
// real denials, not reasoning:
//   1. Tenant isolation (Pass 8A): one workspace's file storage is unreachable
//      from another workspace. A real A-member session reads A's object but is
//      denied B's, and the reverse; cross-tenant insert and delete are denied;
//      and the files metadata table is tenant-isolated with read_only unable to
//      write it.
//   2. Write-role tightness (storage hardening, migration 0033): SELECT stays
//      member-level so a read_only member still reads and downloads its own
//      workspace's objects, but INSERT and DELETE now need a record-writing
//      role, so read_only is denied writing or deleting storage objects while a
//      write-role (staff) member can.
//
// The admin client (service role, bypasses RLS) places the objects under A's and
// B's paths in the private 'attachments' bucket. The actual storage-denial
// output is printed. Cleans up after itself; exits non-zero if any assertion
// fails.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  console.error(
    "Missing Supabase env vars. Run via: npm run test:files-storage (reads .env.local)"
  );
  process.exit(1);
}

const BUCKET = "attachments";

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

// Renders a storage/postgrest error the way storage actually returns it, so the
// denial is shown verbatim rather than described.
function denial(error: unknown): string {
  if (!error) return "no error (unexpected success)";
  const e = error as { message?: string; statusCode?: string; status?: number };
  const status = e.statusCode ?? e.status;
  return `${status ? `[${status}] ` : ""}${e.message ?? JSON.stringify(error)}`;
}

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;

async function createOrg(label: string) {
  const { data, error } = await admin
    .from("organisations")
    .insert({ name: `Files ${label} ${run}`, slug: `files-${label}-${run}` })
    .select("id")
    .single();
  if (error) fatal(`create org ${label}`, error.message);
  return data.id as string;
}

async function createUser(label: string, orgId: string, role: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `user-${label}-${run}@files.test`,
    password,
    email_confirm: true,
  });
  if (error || !data.user) fatal(`create user ${label}`, error?.message ?? "no user");
  const membership = await admin.from("organisation_memberships").insert({
    organisation_id: orgId,
    user_id: data.user.id,
    role,
    status: "active",
  });
  if (membership.error) fatal(`membership ${label}`, membership.error.message);
  return data.user.id as string;
}

async function createCustomer(orgId: string, label: string) {
  const { data, error } = await admin
    .from("customers")
    .insert({ organisation_id: orgId, name: `Customer ${label} ${run}` })
    .select("id")
    .single();
  if (error) fatal(`create customer ${label}`, error.message);
  return data.id as string;
}

async function signIn(label: string): Promise<SupabaseClient> {
  const client = createClient(url!, publishableKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: `user-${label}-${run}@files.test`,
    password,
  });
  if (error) fatal(`sign in ${label}`, error.message);
  return client;
}

const orgA = await createOrg("a");
const orgB = await createOrg("b");
await createUser("a", orgA, "client_admin");
await createUser("b", orgB, "client_admin");
await createUser("ro", orgA, "read_only");
await createUser("staff", orgA, "staff");
const custA = await createCustomer(orgA, "a");
const custB = await createCustomer(orgB, "b");

// The path convention: organisation_id/related_type/related_id/<uuid>-filename.
const pathA = `${orgA}/customer/${custA}/${crypto.randomUUID()}-secret-a.txt`;
const pathB = `${orgB}/customer/${custB}/${crypto.randomUUID()}-secret-b.txt`;
const evilPath = `${orgB}/customer/${custB}/${crypto.randomUUID()}-evil.txt`;
const createdPaths = [pathA, pathB, evilPath];

// Logo objects to clean up from the public 'logos' bucket (a different bucket).
const logosToClean: string[] = [];

async function adminUpload(path: string, body: string) {
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, new Blob([body], { type: "text/plain" }), { upsert: true });
  if (error) fatal(`admin upload ${path}`, error.message);
}

try {
  await adminUpload(pathA, "secret contents for workspace A");
  await adminUpload(pathB, "secret contents for workspace B");

  const clientA = await signIn("a");
  const clientB = await signIn("b");
  const clientRO = await signIn("ro");
  const clientStaff = await signIn("staff");

  // --- Storage isolation (the centrepiece) ---

  const aReadsA = await clientA.storage.from(BUCKET).download(pathA);
  check(
    "A member reads A's object",
    aReadsA.error === null && aReadsA.data !== null,
    denial(aReadsA.error)
  );

  const aReadsB = await clientA.storage.from(BUCKET).download(pathB);
  check(
    "A member is DENIED B's object",
    aReadsB.error !== null && aReadsB.data === null,
    "unexpectedly readable"
  );
  console.log(`        storage denial (A reading B): ${denial(aReadsB.error)}`);

  const bReadsB = await clientB.storage.from(BUCKET).download(pathB);
  check(
    "B member reads B's object",
    bReadsB.error === null && bReadsB.data !== null,
    denial(bReadsB.error)
  );

  const bReadsA = await clientB.storage.from(BUCKET).download(pathA);
  check(
    "B member is DENIED A's object",
    bReadsA.error !== null && bReadsA.data === null,
    "unexpectedly readable"
  );
  console.log(`        storage denial (B reading A): ${denial(bReadsA.error)}`);

  // Cross-tenant insert: A tries to write into B's path.
  const aWritesB = await clientA.storage
    .from(BUCKET)
    .upload(evilPath, new Blob(["evil"], { type: "text/plain" }));
  check(
    "A member is DENIED writing into B's path",
    aWritesB.error !== null,
    "upload unexpectedly succeeded"
  );
  console.log(`        storage denial (A writing into B): ${denial(aWritesB.error)}`);

  // Cross-tenant delete: A tries to remove B's object; it must survive.
  await clientA.storage.from(BUCKET).remove([pathB]);
  const survives = await admin.storage.from(BUCKET).download(pathB);
  check(
    "A member's delete of B's object removes nothing (it survives)",
    survives.error === null && survives.data !== null,
    "B's object was removed by an A member"
  );

  // --- Storage write-role tightness (migration 0033) ---

  // SELECT stays member-level: a read_only member still reads and downloads its
  // own workspace's object.
  const roReadsA = await clientRO.storage.from(BUCKET).download(pathA);
  check(
    "read_only member reads (downloads) its own workspace's object",
    roReadsA.error === null && roReadsA.data !== null,
    denial(roReadsA.error)
  );

  // INSERT now needs a write role: a read_only member is denied writing an
  // object into its own workspace's path (it could before this pass).
  const roInsertPath = `${orgA}/customer/${custA}/${crypto.randomUUID()}-ro-insert.txt`;
  createdPaths.push(roInsertPath); // harmless if it never landed
  const roWrites = await clientRO.storage
    .from(BUCKET)
    .upload(roInsertPath, new Blob(["ro bytes"], { type: "text/plain" }));
  check(
    "read_only member is DENIED inserting a storage object in its own workspace",
    roWrites.error !== null,
    "upload unexpectedly succeeded"
  );
  console.log(`        storage denial (read_only insert): ${denial(roWrites.error)}`);

  // DELETE now needs a write role: a read_only member cannot delete a real
  // object in its own workspace; the DELETE policy matches nothing, so the
  // object survives (a delete denial manifests as "removes nothing", as with a
  // cross-tenant delete).
  const roRemove = await clientRO.storage.from(BUCKET).remove([pathA]);
  const survivesRo = await admin.storage.from(BUCKET).download(pathA);
  check(
    "read_only member's delete of its own workspace's object removes nothing (it survives)",
    survivesRo.error === null && survivesRo.data !== null,
    "read_only removed its own workspace's object"
  );
  console.log(
    `        storage delete by read_only reported ${roRemove.data?.length ?? 0} object(s) removed (object survives)`
  );

  // A write-role member (staff) can insert and delete in its own workspace, so
  // the tightening limits the role, not the workspace.
  const staffPath = `${orgA}/customer/${custA}/${crypto.randomUUID()}-staff.txt`;
  createdPaths.push(staffPath);
  const staffWrites = await clientStaff.storage
    .from(BUCKET)
    .upload(staffPath, new Blob(["staff bytes"], { type: "text/plain" }));
  check(
    "write-role (staff) member can insert a storage object in its own workspace",
    staffWrites.error === null,
    denial(staffWrites.error)
  );

  await clientStaff.storage.from(BUCKET).remove([staffPath]);
  const goneAfterStaff = await admin.storage.from(BUCKET).download(staffPath);
  check(
    "write-role (staff) member can delete a storage object in its own workspace",
    goneAfterStaff.error !== null,
    "staff's object was not deleted"
  );

  // --- Files metadata table isolation ---

  const fileRow = (orgId: string, relatedId: string, path: string) => ({
    organisation_id: orgId,
    related_type: "customer",
    related_id: relatedId,
    filename: "secret.txt",
    storage_path: path,
    size_bytes: 30,
    mime_type: "text/plain",
  });
  const insA = await admin.from("files").insert(fileRow(orgA, custA, pathA)).select("id").single();
  if (insA.error) fatal("insert file A", insA.error.message);
  const insB = await admin.from("files").insert(fileRow(orgB, custB, pathB)).select("id").single();
  if (insB.error) fatal("insert file B", insB.error.message);
  const fileBId = insB.data.id as string;

  const aFiles = await clientA
    .from("files")
    .select("id, organisation_id")
    .in("organisation_id", [orgA, orgB]);
  check(
    "A member reads only A's file rows",
    aFiles.error === null &&
      (aFiles.data?.length ?? 0) >= 1 &&
      aFiles.data!.every((r) => r.organisation_id === orgA),
    aFiles.error?.message ?? `saw ${aFiles.data?.length} rows`
  );

  const aReadsBRow = await clientA.from("files").select("id").eq("id", fileBId);
  check(
    "A member cannot read B's file row by id",
    aReadsBRow.error === null && aReadsBRow.data?.length === 0,
    aReadsBRow.error?.message ?? `saw ${aReadsBRow.data?.length} rows`
  );

  const roInsert = await clientRO.from("files").insert(
    fileRow(orgA, custA, `${orgA}/customer/${custA}/${crypto.randomUUID()}-ro.txt`)
  );
  check(
    "read_only cannot write the files table",
    roInsert.error !== null,
    "insert unexpectedly succeeded"
  );

  const aWritesBRow = await clientA.from("files").insert(
    fileRow(orgB, custB, `${orgB}/customer/${custB}/${crypto.randomUUID()}-x.txt`)
  );
  check(
    "an A member cannot insert a file row for organisation B",
    aWritesBRow.error !== null,
    "insert unexpectedly succeeded"
  );

  // --- logos bucket: public read, admin-only write, own-org isolation ---
  // Unlike attachments, logos are public-read (the unauthenticated quote page
  // shows them) and writes are admin-only (a branding setting), still scoped to
  // the workspace's own path. The blob declares image/png so the bucket's
  // allowed_mime_types accepts it; storage RLS is what these checks exercise.
  const LOGOS = "logos";
  const logoBytes = () =>
    new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
  const logoA = `${orgA}/logo-${crypto.randomUUID()}.png`;
  logosToClean.push(logoA);

  // A client_admin uploads a logo under its own workspace's path.
  const adminLogo = await clientA.storage.from(LOGOS).upload(logoA, logoBytes());
  check(
    "client_admin can upload a logo in its own workspace",
    adminLogo.error === null,
    denial(adminLogo.error)
  );

  // Public read: an anonymous (no-auth) client can download it, which is what
  // the unauthenticated public quote page relies on.
  const anon = createClient(url!, publishableKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anonReads = await anon.storage.from(LOGOS).download(logoA);
  check(
    "an anonymous client can read a logo (public read)",
    anonReads.error === null && anonReads.data !== null,
    denial(anonReads.error)
  );

  // A non-admin member is denied uploading a logo, even in its own workspace.
  const staffLogo = await clientStaff.storage
    .from(LOGOS)
    .upload(`${orgA}/logo-${crypto.randomUUID()}.png`, logoBytes());
  check(
    "a non-admin (staff) member is DENIED uploading a logo",
    staffLogo.error !== null,
    "upload unexpectedly succeeded"
  );
  console.log(`        storage denial (staff logo insert): ${denial(staffLogo.error)}`);

  const roLogo = await clientRO.storage
    .from(LOGOS)
    .upload(`${orgA}/logo-${crypto.randomUUID()}.png`, logoBytes());
  check(
    "a non-admin (read_only) member is DENIED uploading a logo",
    roLogo.error !== null,
    "upload unexpectedly succeeded"
  );

  // Cross-tenant insert: A's admin cannot upload into B's path.
  const aLogoIntoB = await clientA.storage
    .from(LOGOS)
    .upload(`${orgB}/logo-${crypto.randomUUID()}.png`, logoBytes());
  check(
    "a client_admin is DENIED uploading a logo into another workspace's path",
    aLogoIntoB.error !== null,
    "upload unexpectedly succeeded"
  );
  console.log(`        storage denial (A admin into B): ${denial(aLogoIntoB.error)}`);

  // Cross-tenant delete: B's admin cannot delete A's logo; it survives.
  await clientB.storage.from(LOGOS).remove([logoA]);
  const logoSurvives = await admin.storage.from(LOGOS).download(logoA);
  check(
    "another workspace's admin cannot delete this org's logo (it survives)",
    logoSurvives.error === null && logoSurvives.data !== null,
    "logo was removed cross-tenant"
  );

  // The owning admin can delete its own logo.
  await clientA.storage.from(LOGOS).remove([logoA]);
  const logoGone = await admin.storage.from(LOGOS).download(logoA);
  check(
    "client_admin can delete its own logo in its own workspace",
    logoGone.error !== null,
    "logo was not deleted"
  );
} finally {
  await admin.storage.from(BUCKET).remove(createdPaths);
  await admin.storage.from("logos").remove(logosToClean);
  await admin.from("organisations").delete().in("id", [orgA, orgB]);
  const { data: leftoverUsers } = await admin.auth.admin.listUsers();
  for (const u of leftoverUsers?.users ?? []) {
    if (u.email?.endsWith(`-${run}@files.test`)) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll files storage isolation assertions passed");
