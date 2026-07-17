// Issue a secret for an inbound sender (GEM CRM and friends) and store only its
// hash in inbound_sources.
//
// The raw token is printed ONCE, here, and never stored, logged or transmitted
// anywhere else. Copy it into the sender's env at that moment: nothing can
// recover it afterwards, by design. If it is lost, revoke the row and issue a
// new one.
//
// Run against PROD (note the env file: .env.vercel.local carries the prod keys;
// .env.local points at the local stack):
//
//   node --env-file=.env.vercel.local scripts/issue-inbound-source.mts \
//     --source-app gem-crm --label "GEM CRM production"
//
// Rotation: issue a second secret for the same source_app, let the sender cut
// over, then revoke the old row. Several live rows per source_app are allowed
// precisely so this needs no downtime:
//   update public.inbound_sources set revoked_at = now() where id = '<id>';

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const sourceApp = arg("--source-app");
const label = arg("--label");

if (!sourceApp || !label) {
  console.error(
    'Usage: node --env-file=.env.vercel.local scripts/issue-inbound-source.mts --source-app <app> --label "<label>"'
  );
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error(
    "Missing Supabase env vars. Run via: node --env-file=.env.vercel.local ..."
  );
  process.exit(1);
}

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// The row needs an owner, and Spotlight is single-operator by design. Assert
// that rather than assume it, matching create_client_request, which raises on
// the same condition: a second login should break this loudly, not silently
// hand the secret to the wrong operator.
const { data: list, error: listError } = await admin.auth.admin.listUsers();
if (listError) {
  console.error(`FAIL  could not list users: ${listError.message}`);
  process.exit(1);
}
if (list.users.length !== 1) {
  console.error(
    `FAIL  expected exactly one operator, found ${list.users.length}. Pass the intended operator explicitly before issuing.`
  );
  process.exit(1);
}
const operatorId = list.users[0].id;

// 32 bytes of CSPRNG. base64url so it survives a header, an env file and a shell
// without quoting or escaping.
const token = randomBytes(32).toString("base64url");
const secretHash = createHash("sha256").update(token).digest("hex");
// Display only, so two live secrets can be told apart in a list without holding
// either. Short enough to be useless on its own.
const secretPrefix = token.slice(0, 8);

// bytea over PostgREST is hex with a \x prefix, the same shape
// lib/content-api/auth.ts uses for its key hashes.
const { data, error } = await admin
  .from("inbound_sources")
  .insert({
    operator_id: operatorId,
    source_app: sourceApp,
    secret_hash: `\\x${secretHash}`,
    secret_prefix: secretPrefix,
    label,
  })
  .select("id, source_app, secret_prefix, created_at")
  .single();

if (error) {
  console.error(`FAIL  could not store the source: ${error.message}`);
  process.exit(1);
}

console.log("");
console.log("  Stored (hash only, the token itself is not saved anywhere):");
console.log(`    id            ${data.id}`);
console.log(`    source_app    ${data.source_app}`);
console.log(`    secret_prefix ${data.secret_prefix}`);
console.log(`    label         ${label}`);
console.log("");
console.log("  RAW TOKEN, SHOWN ONCE. Copy it into the sender's env now:");
console.log("");
console.log(`    ${token}`);
console.log("");
console.log("  It cannot be recovered. If lost, revoke this row and reissue:");
console.log(
  `    update public.inbound_sources set revoked_at = now() where id = '${data.id}';`
);
console.log("");
