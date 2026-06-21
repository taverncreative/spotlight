// Minimal single-operator seed. Creates the one operator login John signs in
// with. No organisations, memberships, modules or demo records: Spotlight is
// single-operator, so a working auth user is all the verification path needs.
//
// Run with: npm run seed:demo  (reads .env.local via node --env-file)
// Idempotent: if the operator already exists, its password is reset.

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

if (existing) {
  const { error } = await admin.auth.admin.updateUserById(existing.id, {
    password: OPERATOR_PASSWORD,
    email_confirm: true,
  });
  if (error) {
    console.error(`FAIL  could not update operator: ${error.message}`);
    process.exit(1);
  }
  console.log(`Operator already existed; password reset. id=${existing.id}`);
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email: OPERATOR_EMAIL,
    password: OPERATOR_PASSWORD,
    email_confirm: true,
  });
  if (error) {
    console.error(`FAIL  could not create operator: ${error.message}`);
    process.exit(1);
  }
  console.log(`Operator created. id=${data.user?.id}`);
}

console.log(`PASS  single-operator seed complete (${OPERATOR_EMAIL})`);
