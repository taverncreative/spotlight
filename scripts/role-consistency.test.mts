// Role-consistency guard. Runs with: npm run test:role-consistency
//
// Reads the record.write role set from the database (record_write_roles(),
// the single SQL source) and from the TypeScript capability matrix
// (lib/capabilities.ts, the single TS source) and asserts they are exactly
// the same set. If anyone changes one without the other, this fails loudly.

import { createClient } from "@supabase/supabase-js";
import { CAPABILITIES } from "../lib/capabilities.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !secretKey) {
  console.error(
    "Missing Supabase env vars. Run via: npm run test:role-consistency (reads .env.local)"
  );
  process.exit(1);
}

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await admin.rpc("record_write_roles");
if (error) {
  console.error(`FAIL  could not read record_write_roles(): ${error.message}`);
  process.exit(1);
}

const dbRoles = [...(data as string[])].sort();
const tsRoles = [...CAPABILITIES["record.write"]].sort();

console.log(`database:   ${dbRoles.join(", ")}`);
console.log(`typescript: ${tsRoles.join(", ")}`);

if (
  dbRoles.length !== tsRoles.length ||
  dbRoles.some((role, index) => role !== tsRoles[index])
) {
  console.error(
    "\nFAIL  the record.write role set has diverged between the database " +
      "(record_write_roles in migration 0017) and lib/capabilities.ts. " +
      "Change both together."
  );
  process.exit(1);
}

console.log("\nPASS  database and TypeScript record.write role sets match");
