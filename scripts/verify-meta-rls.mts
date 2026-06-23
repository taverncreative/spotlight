// Data-layer verification for the Meta-connect schema (no live Meta needed).
// Proves, against the local DB, that:
//   1. meta_accounts is operator-scoped: an operator sees its own rows but not
//      another operator's, and a session cannot write a row owned by someone
//      else (the with-check predicate blocks it).
//   2. a facebook Page row and a child instagram row (parent_account_id set)
//      insert and read back, with operator_id defaulting to the session.
//   3. social_post_targets.meta_account_id still resolves under the new
//      ownership, and the owns_social_post target policy still admits the insert.
//
// Run with: node --env-file=.env.local scripts/verify-meta-rls.mts
// Assumes db:reset + seed:demo have run (operator A = the seeded demo login).
// Idempotent: cleans its own fixtures and can be re-run without a reset.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const A_EMAIL = "demo@kestrellifting.co.uk";
const A_PASSWORD = "KestrelDemo2026!";
const B_EMAIL = "meta-rls-b@example.test";
const B_PASSWORD = "MetaRlsB2026!";

const PAGE_EXT = "rls-test-page-1";
const IG_EXT = "rls-test-ig-1";
const SPOOF_EXT = "rls-test-page-b-spoof";
const DUMMY_CIPHER = Buffer.from("dummy-token").toString("base64");
const expiry = new Date(Date.now() + 60 * 864e5).toISOString();

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

async function asOperator(email: string, password: string) {
  const c = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) {
    console.error(`sign-in failed for ${email}: ${error.message}`);
    process.exit(1);
  }
  return c;
}

// --- ensure operator B exists (A is the seeded demo operator) ---
const { data: list } = await admin.auth.admin.listUsers();
let bId = list?.users.find((u) => u.email === B_EMAIL)?.id;
if (bId) {
  await admin.auth.admin.updateUserById(bId, {
    password: B_PASSWORD,
    email_confirm: true,
  });
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email: B_EMAIL,
    password: B_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    console.error(`could not create operator B: ${error?.message}`);
    process.exit(1);
  }
  bId = data.user.id;
}

const a = await asOperator(A_EMAIL, A_PASSWORD);
const b = await asOperator(B_EMAIL, B_PASSWORD);

const { data: aUser } = await a.auth.getUser();
const aId = aUser.user!.id;
const { data: aClients } = await a.from("clients").select("id").limit(1);
const aClientId = aClients?.[0]?.id as string | undefined;
check("operator A has a seeded client", !!aClientId, aClientId ? "" : "run seed:demo");

// Clean any prior fixtures (idempotent reruns without a reset).
await a.from("meta_accounts").delete().in("external_id", [PAGE_EXT, IG_EXT]);
await admin.from("meta_accounts").delete().eq("external_id", SPOOF_EXT);

// --- Test 1: A inserts a facebook page row (operator_id defaults to A) ---
const { data: fbRow, error: fbErr } = await a
  .from("meta_accounts")
  .insert({
    platform: "facebook",
    external_id: PAGE_EXT,
    display_name: "RLS Test Page",
    access_token: DUMMY_CIPHER,
    token_expires_at: expiry,
  })
  .select("id, operator_id")
  .single();
check("A inserts a facebook meta_accounts row", !fbErr && !!fbRow, fbErr?.message ?? "");
check("inserted row defaulted operator_id to A", fbRow?.operator_id === aId);

// --- Test 2: A inserts a child instagram row with parent_account_id ---
if (fbRow) {
  const { data: igRow, error: igErr } = await a
    .from("meta_accounts")
    .insert({
      platform: "instagram",
      external_id: IG_EXT,
      display_name: "rls_test_ig",
      access_token: DUMMY_CIPHER,
      parent_account_id: fbRow.id,
      token_expires_at: expiry,
    })
    .select("id, parent_account_id")
    .single();
  check(
    "A inserts a child instagram row pointing at the Page",
    !igErr && igRow?.parent_account_id === fbRow.id,
    igErr?.message ?? ""
  );
}

// --- Test 3: A reads back both of its rows ---
const { data: aRows } = await a
  .from("meta_accounts")
  .select("id")
  .in("external_id", [PAGE_EXT, IG_EXT]);
check("A reads back its 2 rows", (aRows?.length ?? 0) === 2, `saw ${aRows?.length ?? 0}`);

// --- Test 4: B cannot see A's rows (operator-scoped RLS) ---
const { data: bRows } = await b
  .from("meta_accounts")
  .select("id")
  .in("external_id", [PAGE_EXT, IG_EXT]);
check("B cannot see A's meta_accounts rows", (bRows?.length ?? 0) === 0, `saw ${bRows?.length ?? 0}`);

// --- Test 5: B cannot insert a row owned by A (with-check blocks it) ---
const { error: bInsErr } = await b.from("meta_accounts").insert({
  operator_id: aId,
  platform: "facebook",
  external_id: SPOOF_EXT,
  access_token: DUMMY_CIPHER,
});
check(
  "B blocked from inserting a row owned by A",
  !!bInsErr,
  bInsErr ? `rejected (${bInsErr.code ?? bInsErr.message})` : "insert unexpectedly succeeded"
);
await admin.from("meta_accounts").delete().eq("external_id", SPOOF_EXT);

// --- Test 6: targets FK resolves + owns_social_post admits the insert ---
let postId: string | undefined;
if (aClientId && fbRow) {
  const { data: post, error: postErr } = await a
    .from("social_posts")
    .insert({ client_id: aClientId, caption: "rls test", status: "draft" })
    .select("id")
    .single();
  postId = post?.id as string | undefined;
  check("A creates a social_post for its client", !postErr && !!postId, postErr?.message ?? "");

  if (postId) {
    const { data: tgt, error: tgtErr } = await a
      .from("social_post_targets")
      .insert({ post_id: postId, meta_account_id: fbRow.id })
      .select("id, meta_account_id")
      .single();
    check(
      "social_post_targets FK + owns_social_post insert resolves",
      !tgtErr && tgt?.meta_account_id === fbRow.id,
      tgtErr?.message ?? ""
    );
  }
}

// --- cleanup (best-effort) ---
if (postId) await a.from("social_posts").delete().eq("id", postId); // cascades targets
await a.from("meta_accounts").delete().in("external_id", [PAGE_EXT, IG_EXT]);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
