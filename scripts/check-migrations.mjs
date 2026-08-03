#!/usr/bin/env node
// Compare production's migration ledger against the migration files on this
// branch, and fail loudly on any disagreement.
//
// WHY THIS EXISTS. 0053_client_requests_intake_slug_fix was applied to
// production from an unmerged branch and its file never reached main. Prod's
// ledger carried it; the repo did not. Nothing complained. The consequences were
// both silent: db:reset built a local database still carrying the bug 0053
// fixes, and rebuilding prod from main would have dropped the fix entirely. It
// was a live 500 on every inbound request from one client, invisible in the
// repo, and it was found by accident weeks later.
//
// The ledger is the only place that drift shows, so something has to read it.
//
// FOUR FAILURES, all treated as errors rather than warnings:
//
//   1. Applied in prod, no file here    -- prod is ahead of the repo. The 0053
//                                          case. The most dangerous, because the
//                                          SQL exists nowhere in version control.
//   2. File here, not applied in prod   -- a migration written and forgotten, or
//                                          one applied to local only.
//   3. Same version, different name     -- two different migrations wearing one
//                                          number.
//   4. Duplicate version prefixes       -- two files claiming the same number, so
//                                          apply order is undefined.
//
// GAPS ARE NOT AN ERROR. 0051 and 0052 are deliberately absent from both sides
// (an unmerged feature), and a guard that cried about that would be muted within
// a week.
//
// Reads the ledger with psql rather than a driver, so this needs no dependency
// and behaves the same as every other database check in this repo.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const MIGRATIONS_DIR = "supabase/migrations";
const allowSkip = process.argv.includes("--allow-skip");

// PROD_DB_URL lives in the environment or in .env.vercel.local, which is where
// the rest of this repo's tooling expects it.
function prodUrl() {
  if (process.env.PROD_DB_URL) return process.env.PROD_DB_URL;
  if (!existsSync(".env.vercel.local")) return null;
  for (const line of readFileSync(".env.vercel.local", "utf8").split("\n")) {
    if (line.startsWith("PROD_DB_URL=")) {
      return line.slice("PROD_DB_URL=".length).trim().replace(/^"|"$/g, "");
    }
  }
  return null;
}

function fileVersions() {
  const byVersion = new Map();
  const duplicates = [];
  for (const name of readdirSync(MIGRATIONS_DIR).sort()) {
    const match = /^(\d+)_(.+)\.sql$/.exec(name);
    if (!match) continue;
    const [, version, label] = match;
    if (byVersion.has(version)) {
      // Name BOTH files: reporting only the second one seen accuses whichever
      // sorted later, which is as likely to be the innocent one.
      duplicates.push({
        version,
        name,
        first: `${version}_${byVersion.get(version)}.sql`,
      });
    } else byVersion.set(version, label);
  }
  return { byVersion, duplicates };
}

function ledgerVersions(url) {
  const out = execFileSync(
    "psql",
    [
      url,
      "-At",
      "-F",
      "|",
      "-c",
      "select version, coalesce(name,'') from supabase_migrations.schema_migrations order by version;",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const byVersion = new Map();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const at = line.indexOf("|");
    byVersion.set(line.slice(0, at), line.slice(at + 1));
  }
  return byVersion;
}

const url = prodUrl();
if (!url) {
  if (allowSkip) {
    console.log("migration check: skipped (no PROD_DB_URL available here)");
    process.exit(0);
  }
  console.error(
    "migration check: PROD_DB_URL is not set and .env.vercel.local has no PROD_DB_URL.\n" +
      "  export PROD_DB_URL='postgresql://...' and try again."
  );
  process.exit(2);
}

const { byVersion: files, duplicates } = fileVersions();

let ledger;
try {
  ledger = ledgerVersions(url);
} catch (error) {
  console.error(
    "migration check: could not read the production ledger.\n  " +
      String(error.stderr || error.message)
        .trim()
        .split("\n")[0]
  );
  process.exit(2);
}

const problems = [];

for (const { version, name, first } of duplicates) {
  problems.push({
    kind: "Duplicate version number",
    detail: `${first} and ${name} both claim version ${version}. Apply order is undefined.`,
  });
}

for (const [version, name] of [...ledger].sort()) {
  if (!files.has(version)) {
    problems.push({
      kind: "PROD IS AHEAD OF THE REPO",
      detail:
        `${version}_${name} is applied in production but has no file on this branch.\n` +
        `      The SQL exists nowhere in version control. Find it (try: ` +
        `git log --all --name-only -- '${MIGRATIONS_DIR}/${version}*') and bring it onto main.`,
    });
  } else if (files.get(version) !== name) {
    problems.push({
      kind: "Version applied under a different name",
      detail: `${version}: production ran "${name}", this branch has "${files.get(version)}".`,
    });
  }
}

for (const [version, label] of [...files].sort()) {
  if (!ledger.has(version)) {
    problems.push({
      kind: "Never applied to production",
      detail: `${version}_${label}.sql exists here but is not in production's ledger.`,
    });
  }
}

if (problems.length === 0) {
  console.log(
    `migration check: OK — ${files.size} files, ${ledger.size} applied, no drift.`
  );
  process.exit(0);
}

console.error(`\nmigration check FAILED — ${problems.length} problem(s)\n`);
for (const problem of problems) {
  console.error(`  ✗ ${problem.kind}\n      ${problem.detail}\n`);
}
console.error(
  "Gaps in numbering are fine and are not reported. These are genuine disagreements\n" +
    "between what production has run and what this branch contains.\n"
);
process.exit(1);
