// Single-operator seed plus sample clients for the app shell. Creates the one
// operator login John signs in with, and two sample clients so the per-client
// shell is navigable. The sample clients are dev fixtures; Slice 5's real create
// flow supersedes them.
//
// Run with: npm run seed:demo  (reads .env.local via node --env-file)
// Idempotent: re-running resets the operator password and upserts the clients.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !secretKey) {
  console.error(
    "Missing Supabase env vars. Run via: npm run seed:demo (reads .env.local)"
  );
  process.exit(1);
}

// Kept as the existing demo login for now so the verification path still works;
// rename to John's real operator login in a later pass.
const OPERATOR_EMAIL = "demo@kestrellifting.co.uk";
const OPERATOR_PASSWORD = "KestrelDemo2026!";

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: list, error: listError } = await admin.auth.admin.listUsers();
if (listError) {
  console.error(`FAIL  could not list users: ${listError.message}`);
  process.exit(1);
}

const existing = list.users.find((user) => user.email === OPERATOR_EMAIL);

let operatorId: string;
if (existing) {
  const { error } = await admin.auth.admin.updateUserById(existing.id, {
    password: OPERATOR_PASSWORD,
    email_confirm: true,
  });
  if (error) {
    console.error(`FAIL  could not update operator: ${error.message}`);
    process.exit(1);
  }
  operatorId = existing.id;
  console.log(`Operator already existed; password reset. id=${operatorId}`);
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email: OPERATOR_EMAIL,
    password: OPERATOR_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    console.error(`FAIL  could not create operator: ${error?.message}`);
    process.exit(1);
  }
  operatorId = data.user.id;
  console.log(`Operator created. id=${operatorId}`);
}

// Sample clients (dev fixtures). operator_id is set explicitly because the
// service-role client bypasses RLS, so the auth.uid() column default does not
// apply here. Upsert on the unique (operator_id, slug) so re-runs are clean.
const sampleClients = [
  { operator_id: operatorId, name: "GEM Services", slug: "gem-services" },
  {
    operator_id: operatorId,
    name: "Therapy Hair and Body Nails",
    slug: "therapy-hair-body-nails",
  },
];

const { error: clientsError } = await admin
  .from("clients")
  .upsert(sampleClients, { onConflict: "operator_id,slug" });
if (clientsError) {
  console.error(`FAIL  could not seed clients: ${clientsError.message}`);
  process.exit(1);
}
console.log(`Seeded ${sampleClients.length} sample clients.`);

console.log(`PASS  single-operator seed complete (${OPERATOR_EMAIL})`);
