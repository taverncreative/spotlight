// Files server-action test for Pass 8B. Runs with:
// npm run test:files-actions
//
// Exercises the real files actions through the harness route with real signed-in
// sessions per role, and performs the byte transfers the way a browser does:
// directly against storage on the user's own session (so the storage RLS, not a
// server route, governs them). Organisation A has the customers, leads and
// quotes modules; organisation B has customers only.
//
// Proves: an upload creates both the object (under the correct workspace path)
// and the metadata row; an oversized file is rejected (by the bucket limit and
// by recordFile); listing returns the record's files newest first; download
// returns the actual bytes; delete removes both the row and the object and is
// audited; read_only can list and download but cannot upload or delete;
// cross-tenant is blocked (no upload to, download of or delete of another
// workspace's record or object); the polymorphic-link integrity holds (no upload
// to a non-existent, cross-organisation or soft-deleted record); and the new
// CHECK rejects a metadata row whose path is not under its own organisation.

import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const BUCKET = "attachments";
// Mirrors MAX_FILE_SIZE_BYTES in lib/files/schemas.ts and the bucket
// file_size_limit in migration 0032. 25 MiB.
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const slugA = `fa-a-${run}`;
const slugB = `fa-b-${run}`;
const emailFor = (label: string) => `${label}-${run}@files-actions.test`;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgIds: Record<string, string> = {};
const userIds: string[] = [];
const planIds: string[] = [];
// Every object path we cause to exist, removed in afterAll (org delete cascades
// the metadata rows but not the stored objects).
const createdPaths: string[] = [];

let custAId: string;
let custADeletedId: string;
let leadAId: string;
let siteAId: string;
let quoteAId: string;
let custLifecycleId: string;
let custBId: string;
let staffAUserId: string;
let fileBId: string;
let pathB: string;

async function makePlan(label: string, modules: string[]) {
  const plan = await admin
    .from("plans")
    .insert({ key: `fa-${label}-${run}`, name: "FA", monthly_price_pence: 1000 })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  planIds.push(plan.data.id);
  for (const moduleKey of modules) {
    const linked = await admin
      .from("plan_modules")
      .insert({ plan_id: plan.data.id, module: moduleKey });
    if (linked.error) throw new Error(linked.error.message);
  }
  const assigned = await admin.rpc("assign_plan", {
    org_id: orgIds[label],
    new_plan_id: plan.data.id,
  });
  if (assigned.error) throw new Error(assigned.error.message);
}

function denial(error: unknown): string {
  if (!error) return "no error (unexpected success)";
  const e = error as { message?: string; statusCode?: string; status?: number };
  const status = e.statusCode ?? e.status;
  return `${status ? `[${status}] ` : ""}${e.message ?? JSON.stringify(error)}`;
}

test.beforeAll(async () => {
  for (const [label, slug] of [
    ["a", slugA],
    ["b", slugB],
  ] as const) {
    const org = await admin
      .from("organisations")
      .insert({ name: `Files Actions ${label} ${run}`, slug })
      .select("id")
      .single();
    if (org.error) throw new Error(org.error.message);
    orgIds[label] = org.data.id;
  }

  await makePlan("a", ["customers", "leads", "quotes"]);
  await makePlan("b", ["customers"]);

  const members: Array<[string, string, string]> = [
    ["readonly-a", "a", "read_only"],
    ["staff-a", "a", "staff"],
    ["staff-b", "b", "staff"],
  ];
  for (const [label, orgLabel, role] of members) {
    const user = await admin.auth.admin.createUser({
      email: emailFor(label),
      password,
      email_confirm: true,
    });
    if (user.error || !user.data.user) throw new Error(user.error?.message);
    userIds.push(user.data.user.id);
    if (label === "staff-a") staffAUserId = user.data.user.id;
    const membership = await admin.from("organisation_memberships").insert({
      organisation_id: orgIds[orgLabel],
      user_id: user.data.user.id,
      role,
      status: "active",
    });
    if (membership.error) throw new Error(membership.error.message);
  }

  // Records in organisation A: one live of each type, a soft-deleted customer,
  // and a dedicated customer the list and delete tests use alone.
  const custA = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.a, name: `Customer A ${run}` })
    .select("id")
    .single();
  if (custA.error) throw new Error(custA.error.message);
  custAId = custA.data.id;

  const custLifecycle = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.a, name: `Lifecycle customer ${run}` })
    .select("id")
    .single();
  if (custLifecycle.error) throw new Error(custLifecycle.error.message);
  custLifecycleId = custLifecycle.data.id;

  const custADeleted = await admin
    .from("customers")
    .insert({
      organisation_id: orgIds.a,
      name: `Deleted customer A ${run}`,
      deleted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (custADeleted.error) throw new Error(custADeleted.error.message);
  custADeletedId = custADeleted.data.id;

  const leadA = await admin
    .from("leads")
    .insert({ organisation_id: orgIds.a, name: `Lead A ${run}` })
    .select("id")
    .single();
  if (leadA.error) throw new Error(leadA.error.message);
  leadAId = leadA.data.id;

  const siteA = await admin
    .from("sites")
    .insert({ organisation_id: orgIds.a, customer_id: custAId, name: `Site A ${run}` })
    .select("id")
    .single();
  if (siteA.error) throw new Error(siteA.error.message);
  siteAId = siteA.data.id;

  const quoteA = await admin
    .from("quotes")
    .insert({ organisation_id: orgIds.a, customer_id: custAId, quote_number: 9201 })
    .select("id")
    .single();
  if (quoteA.error) throw new Error(quoteA.error.message);
  quoteAId = quoteA.data.id;

  const custB = await admin
    .from("customers")
    .insert({ organisation_id: orgIds.b, name: `Customer B ${run}` })
    .select("id")
    .single();
  if (custB.error) throw new Error(custB.error.message);
  custBId = custB.data.id;

  // A real object plus metadata row in organisation B, for the cross-tenant
  // by-id and survival checks. Placed by the admin (service role) directly.
  pathB = `${orgIds.b}/customer/${custBId}/${crypto.randomUUID()}-secret-b.txt`;
  createdPaths.push(pathB);
  const upB = await admin.storage
    .from(BUCKET)
    .upload(pathB, new Blob(["secret contents for workspace B"], { type: "text/plain" }));
  if (upB.error) throw new Error(upB.error.message);
  const fileB = await admin
    .from("files")
    .insert({
      organisation_id: orgIds.b,
      related_type: "customer",
      related_id: custBId,
      filename: "secret-b.txt",
      storage_path: pathB,
      size_bytes: 31,
      mime_type: "text/plain",
    })
    .select("id")
    .single();
  if (fileB.error) throw new Error(fileB.error.message);
  fileBId = fileB.data.id;
});

test.afterAll(async () => {
  await admin.storage.from(BUCKET).remove(createdPaths);
  const ids = Object.values(orgIds);
  await admin.from("audit_log").delete().in("organisation_id", ids);
  // Quotes restrict customer deletion, so clear them before the org cascade.
  await admin.from("quotes").delete().in("organisation_id", ids);
  await admin.from("organisations").delete().in("id", ids);
  await admin.from("plans").delete().in("id", planIds);
  for (const id of userIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

async function signIn(page: Page, label: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(emailFor(label));
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\//);
}

// A second, independent session for the same user, used for the byte transfers
// the way a browser would: directly against storage with the user's JWT, so the
// storage RLS governs them.
async function storageSignIn(label: string): Promise<SupabaseClient> {
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: emailFor(label),
    password,
  });
  if (error) throw new Error(error.message);
  return client;
}

type ActResult = { status: number; data: unknown };

async function act(
  page: Page,
  action: string,
  input: unknown = {},
  slug = slugA
): Promise<ActResult> {
  const response = await page.request.post(`/api/files-harness/${slug}`, {
    data: { action, input },
  });
  let data: unknown = null;
  try {
    data = ((await response.json()) as { data?: unknown }).data ?? null;
  } catch {
    // non-JSON responses (404 pages) leave data null
  }
  return { status: response.status(), data };
}

type FileRow = {
  id: string;
  filename: string;
  size_bytes: number;
  mime_type: string | null;
  related_type: string;
  related_id: string;
  created_by: string | null;
  created_at: string;
};

// The full browser-direct upload flow: server builds the path, the user session
// uploads the bytes to it, the server records the metadata.
async function uploadFlow(
  page: Page,
  storage: SupabaseClient,
  record: { related_type: string; related_id: string },
  filename: string,
  content: string,
  mime: string,
  slug = slugA
): Promise<{ path: string; row: FileRow | null; uploadError: unknown }> {
  const prep = (await act(page, "prepareFileUpload", { ...record, filename }, slug))
    .data as { storage_path: string } | null;
  if (!prep) return { path: "", row: null, uploadError: null };
  createdPaths.push(prep.storage_path);
  const up = await storage.storage
    .from(BUCKET)
    .upload(prep.storage_path, new Blob([content], { type: mime }), {
      contentType: mime,
    });
  const rec = (
    await act(
      page,
      "recordFile",
      {
        ...record,
        filename,
        storage_path: prep.storage_path,
        size_bytes: Buffer.byteLength(content, "utf8"),
        mime_type: mime,
      },
      slug
    )
  ).data as FileRow | null;
  return { path: prep.storage_path, row: rec, uploadError: up.error };
}

async function listFiles(page: Page, record: Record<string, unknown>, slug = slugA) {
  const { data } = await act(page, "listFiles", record, slug);
  return (data as FileRow[]) ?? [];
}

async function auditCount(action: string, targetId: string) {
  const { data } = await admin
    .from("audit_log")
    .select("id")
    .eq("action", action)
    .eq("target_id", targetId);
  return data?.length ?? 0;
}

test("an upload creates the object under the correct path and the metadata row, audited", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  const storage = await storageSignIn("staff-a");
  const content = `PDF-LIKE BYTES ${run}`;

  const { path, row, uploadError } = await uploadFlow(
    page,
    storage,
    { related_type: "customer", related_id: custAId },
    "report.pdf",
    content,
    "application/pdf"
  );

  // The path is built from the record: organisation/type/id/<uuid>-filename.
  expect(path.startsWith(`${orgIds.a}/customer/${custAId}/`)).toBe(true);
  expect(uploadError).toBeNull();

  // The metadata row records what was uploaded.
  expect(row?.id).toBeTruthy();
  expect(row?.filename).toBe("report.pdf");
  expect(row?.size_bytes).toBe(Buffer.byteLength(content, "utf8"));
  expect(row?.mime_type).toBe("application/pdf");
  expect(row?.created_by).toBe(staffAUserId);

  // The object really exists under that path (read back via the admin client).
  const back = await admin.storage.from(BUCKET).download(path);
  expect(back.error).toBeNull();
  expect(await back.data!.text()).toBe(content);

  // The row is listed against the record, and the create is audited.
  const ids = (await listFiles(page, { related_type: "customer", related_id: custAId })).map(
    (f) => f.id
  );
  expect(ids).toContain(row!.id);
  expect(await auditCount("file.created", row!.id)).toBe(1);
});

test("an oversized file is rejected by the bucket limit and by recordFile", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  const storage = await storageSignIn("staff-a");

  // Prepare a path, then attempt to upload more than the bucket allows. Storage
  // rejects the bytes before any metadata is written.
  const prep = (
    await act(page, "prepareFileUpload", {
      related_type: "customer",
      related_id: custAId,
      filename: "big.bin",
    })
  ).data as { storage_path: string };
  createdPaths.push(prep.storage_path);
  const oversized = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1024 * 1024); // 26 MiB
  const up = await storage.storage
    .from(BUCKET)
    .upload(prep.storage_path, new Blob([oversized]), {
      contentType: "application/octet-stream",
    });
  expect(up.error).not.toBeNull();
  console.log(`        storage denial (oversized upload): ${denial(up.error)}`);

  // And recordFile refuses to record an over-limit size (schema cap, a 400).
  const rec = await act(page, "recordFile", {
    related_type: "customer",
    related_id: custAId,
    filename: "big.bin",
    storage_path: prep.storage_path,
    size_bytes: MAX_FILE_SIZE_BYTES + 1,
    mime_type: "application/octet-stream",
  });
  expect(rec.status).toBe(400);
});

test("listFiles returns the record's files newest first with the expected fields", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  const storage = await storageSignIn("staff-a");
  const record = { related_type: "customer", related_id: custLifecycleId };

  const a = await uploadFlow(page, storage, record, "first.txt", `one ${run}`, "text/plain");
  const b = await uploadFlow(page, storage, record, "second.txt", `two ${run}`, "text/plain");
  const c = await uploadFlow(page, storage, record, "third.txt", `three ${run}`, "text/plain");

  const rows = await listFiles(page, record);
  expect(rows.map((r) => r.id)).toEqual([c.row!.id, b.row!.id, a.row!.id]);
  // Each row carries filename, size, type, uploader and timestamp.
  const newest = rows[0];
  expect(newest.filename).toBe("third.txt");
  expect(newest.size_bytes).toBe(Buffer.byteLength(`three ${run}`, "utf8"));
  expect(newest.mime_type).toBe("text/plain");
  expect(newest.created_by).toBe(staffAUserId);
  expect(typeof newest.created_at).toBe("string");
});

test("download returns the actual uploaded bytes", async ({ page }) => {
  await signIn(page, "staff-a");
  const storage = await storageSignIn("staff-a");
  const content = `download me ${crypto.randomUUID()}`;

  const { row } = await uploadFlow(
    page,
    storage,
    { related_type: "customer", related_id: custAId },
    "download.txt",
    content,
    "text/plain"
  );

  const signed = (await act(page, "createFileDownloadUrl", { id: row!.id })).data as {
    signedUrl: string;
  };
  expect(signed?.signedUrl).toBeTruthy();
  const res = await fetch(signed.signedUrl);
  expect(res.ok).toBe(true);
  expect(await res.text()).toBe(content);
});

test("read_only can list and download but cannot upload or delete", async ({ page }) => {
  // A file to act on, created by staff-a.
  await signIn(page, "staff-a");
  const storage = await storageSignIn("staff-a");
  const content = `ro can read ${run}`;
  const { row } = await uploadFlow(
    page,
    storage,
    { related_type: "customer", related_id: custAId },
    "ro.txt",
    content,
    "text/plain"
  );

  await signIn(page, "readonly-a");

  // Read paths are allowed.
  expect(
    (await act(page, "listFiles", { related_type: "customer", related_id: custAId })).status
  ).toBe(200);
  const signed = (await act(page, "createFileDownloadUrl", { id: row!.id })).data as {
    signedUrl: string;
  };
  expect(signed?.signedUrl).toBeTruthy();
  const res = await fetch(signed.signedUrl);
  expect(await res.text()).toBe(content);

  // Write paths are denied (403), so read_only cannot create or remove a file.
  expect(
    (await act(page, "prepareFileUpload", {
      related_type: "customer",
      related_id: custAId,
      filename: "x.txt",
    })).status
  ).toBe(403);
  expect(
    (await act(page, "recordFile", {
      related_type: "customer",
      related_id: custAId,
      filename: "x.txt",
      storage_path: `${orgIds.a}/customer/${custAId}/${crypto.randomUUID()}-x.txt`,
      size_bytes: 1,
      mime_type: "text/plain",
    })).status
  ).toBe(403);
  expect((await act(page, "deleteFile", { id: row!.id })).status).toBe(403);
});

test("cross-tenant file actions and transfers are blocked", async ({ page }) => {
  await signIn(page, "staff-a");
  const storageA = await storageSignIn("staff-a");

  // Cannot prepare or record against organisation B's customer from A.
  expect(
    (await act(page, "prepareFileUpload", {
      related_type: "customer",
      related_id: custBId,
      filename: "x.txt",
    })).data
  ).toBeNull();
  expect(
    (await act(page, "recordFile", {
      related_type: "customer",
      related_id: custBId,
      filename: "x.txt",
      storage_path: pathB,
      size_bytes: 1,
      mime_type: "text/plain",
    })).data
  ).toBeNull();

  // Cannot get a download URL for B's file (the row is invisible from A).
  expect((await act(page, "createFileDownloadUrl", { id: fileBId })).data).toBeNull();

  // Storage itself denies an A session reading or writing B's path.
  const readB = await storageA.storage.from(BUCKET).download(pathB);
  expect(readB.error).not.toBeNull();
  console.log(`        storage denial (A reading B's object): ${denial(readB.error)}`);

  const evilPath = `${orgIds.b}/customer/${custBId}/${crypto.randomUUID()}-evil.txt`;
  createdPaths.push(evilPath);
  const writeB = await storageA.storage
    .from(BUCKET)
    .upload(evilPath, new Blob(["evil"], { type: "text/plain" }));
  expect(writeB.error).not.toBeNull();
  console.log(`        storage denial (A writing into B's path): ${denial(writeB.error)}`);

  // deleteFile of B's file from A is a calm null and removes nothing.
  expect((await act(page, "deleteFile", { id: fileBId })).data).toBeNull();
  const rowSurvives = await admin.from("files").select("id").eq("id", fileBId).maybeSingle();
  expect(rowSurvives.data?.id).toBe(fileBId);
  const objSurvives = await admin.storage.from(BUCKET).download(pathB);
  expect(objSurvives.error).toBeNull();
});

test("polymorphic-link integrity: no upload to a non-existent, cross-organisation or soft-deleted record", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  const storage = await storageSignIn("staff-a");

  const badTargets: Array<[string, string]> = [
    ["customer", crypto.randomUUID()], // non-existent
    ["customer", custBId], // cross-organisation
    ["customer", custADeletedId], // soft-deleted
  ];
  for (const [related_type, related_id] of badTargets) {
    // prepareFileUpload refuses to even build a path.
    expect(
      (await act(page, "prepareFileUpload", {
        related_type,
        related_id,
        filename: "x.txt",
      })).data
    ).toBeNull();
    // recordFile refuses too.
    expect(
      (await act(page, "recordFile", {
        related_type,
        related_id,
        filename: "x.txt",
        storage_path: `${orgIds.a}/${related_type}/${related_id}/${crypto.randomUUID()}-x.txt`,
        size_bytes: 1,
        mime_type: "text/plain",
      })).data
    ).toBeNull();
  }

  // A valid record of each type is accepted end to end.
  const valid: Array<[string, string]> = [
    ["lead", leadAId],
    ["customer", custAId],
    ["site", siteAId],
    ["quote", quoteAId],
  ];
  for (const [related_type, related_id] of valid) {
    const { row } = await uploadFlow(
      page,
      storage,
      { related_type, related_id },
      `valid-${related_type}.txt`,
      `valid ${related_type} ${run}`,
      "text/plain"
    );
    expect(row?.related_type).toBe(related_type);
    expect(row?.related_id).toBe(related_id);
  }

  // Incomplete input is rejected at the schema boundary (400).
  expect(
    (await act(page, "recordFile", {
      related_type: "customer",
      related_id: custAId,
      filename: "x.txt",
    })).status
  ).toBe(400);
  expect(
    (await act(page, "prepareFileUpload", { related_type: "customer", related_id: custAId }))
      .status
  ).toBe(400);
});

test("delete removes both the metadata row and the stored object, audited", async ({
  page,
}) => {
  await signIn(page, "staff-a");
  const storage = await storageSignIn("staff-a");
  const record = { related_type: "customer", related_id: custLifecycleId };

  const { path, row } = await uploadFlow(
    page,
    storage,
    record,
    "to-delete.txt",
    `delete me ${run}`,
    "text/plain"
  );
  // The object exists before the delete.
  expect((await admin.storage.from(BUCKET).download(path)).error).toBeNull();

  const del = (await act(page, "deleteFile", { id: row!.id })).data as { id: string };
  expect(del.id).toBe(row!.id);

  // The row is gone from the listing, and the object is gone from storage.
  expect((await listFiles(page, record)).map((f) => f.id)).not.toContain(row!.id);
  const gone = await admin.storage.from(BUCKET).download(path);
  expect(gone.error).not.toBeNull();

  // The delete is audited.
  expect(await auditCount("file.deleted", row!.id)).toBe(1);
});

test("the storage-path CHECK rejects a metadata row not under its own organisation", async () => {
  // The admin client bypasses RLS but not CHECK constraints, so this proves the
  // database guard itself, independent of any application code.
  const bad = await admin.from("files").insert({
    organisation_id: orgIds.a,
    related_type: "customer",
    related_id: custAId,
    filename: "wrong.txt",
    // Path under organisation B, but the row belongs to A.
    storage_path: `${orgIds.b}/customer/${custBId}/${crypto.randomUUID()}-wrong.txt`,
    size_bytes: 1,
    mime_type: "text/plain",
  });
  expect(bad.error).not.toBeNull();
  console.log(`        CHECK denial (path not under own org): ${denial(bad.error)}`);

  // A correctly-prefixed path inserts fine (positive control); left for the org
  // cascade to clean up (metadata only, no object).
  const good = await admin
    .from("files")
    .insert({
      organisation_id: orgIds.a,
      related_type: "customer",
      related_id: custAId,
      filename: "right.txt",
      storage_path: `${orgIds.a}/customer/${custAId}/${crypto.randomUUID()}-right.txt`,
      size_bytes: 1,
      mime_type: "text/plain",
    })
    .select("id")
    .single();
  expect(good.error).toBeNull();
});
