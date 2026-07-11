// Orphan sweep for the social-media bucket: lists storage objects with no
// matching social_post_media row. Objects live at {client_id}/{post_id}/{file};
// media rows are only written at save time, so a fresh upload from an in-flight
// composer session is expected to look orphaned briefly.
//
// Report-only by default. Deletion requires the explicit --delete flag, and
// even then only orphans older than MIN_AGE_HOURS are removed, so an unsaved
// composer session's uploads are never touched.
//
// Run with: npm run sweep:social-orphans              (report only, .env.local)
//           npm run sweep:social-orphans -- --delete  (delete aged orphans)

import { createClient } from "@supabase/supabase-js";

const BUCKET = "social-media";
const MIN_AGE_HOURS = 24;
const PAGE = 1000;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error(
    "Missing Supabase env vars. Run via: npm run sweep:social-orphans (reads .env.local)"
  );
  process.exit(1);
}

const doDelete = process.argv.includes("--delete");

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Every storage_path referenced by a media row, paged so nothing is missed.
async function referencedPaths(): Promise<Set<string>> {
  const paths = new Set<string>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("social_post_media")
      .select("storage_path")
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error(`FAIL  could not read social_post_media: ${error.message}`);
      process.exit(1);
    }
    for (const row of data ?? []) paths.add(row.storage_path as string);
    if (!data || data.length < PAGE) break;
  }
  return paths;
}

type Entry = { name: string; id: string | null; created_at: string | null };

// List one folder level completely (paged). Folders come back with a null id.
async function listFolder(prefix: string): Promise<Entry[]> {
  const entries: Entry[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE, offset });
    if (error) {
      console.error(`FAIL  could not list "${prefix}": ${error.message}`);
      process.exit(1);
    }
    entries.push(...((data ?? []) as Entry[]));
    if (!data || data.length < PAGE) break;
  }
  return entries;
}

type OrphanFile = { path: string; created_at: string | null; ageHours: number };

function ageHoursOf(createdAt: string | null): number {
  if (!createdAt) return Number.POSITIVE_INFINITY;
  return (Date.now() - new Date(createdAt).getTime()) / 3_600_000;
}

const referenced = await referencedPaths();
const orphans: OrphanFile[] = [];
let scanned = 0;

// Walk {client_id}/{post_id}/{file}: two folder levels, then files.
for (const clientDir of await listFolder("")) {
  if (clientDir.id !== null) continue; // stray root-level file; not app-written
  for (const postDir of await listFolder(clientDir.name)) {
    const postPrefix = `${clientDir.name}/${postDir.name}`;
    if (postDir.id !== null) {
      // A file directly under the client folder; app never writes these.
      scanned += 1;
      if (!referenced.has(postPrefix)) {
        orphans.push({
          path: postPrefix,
          created_at: postDir.created_at,
          ageHours: ageHoursOf(postDir.created_at),
        });
      }
      continue;
    }
    for (const file of await listFolder(postPrefix)) {
      if (file.id === null) continue;
      scanned += 1;
      const path = `${postPrefix}/${file.name}`;
      if (!referenced.has(path)) {
        orphans.push({
          path,
          created_at: file.created_at,
          ageHours: ageHoursOf(file.created_at),
        });
      }
    }
  }
}

console.log(
  `Scanned ${scanned} objects in "${BUCKET}"; ${referenced.size} referenced media rows.`
);
if (orphans.length === 0) {
  console.log("No orphans found.");
  process.exit(0);
}

console.log(`\n${orphans.length} orphan(s):`);
for (const orphan of orphans) {
  const age = Number.isFinite(orphan.ageHours)
    ? `${orphan.ageHours.toFixed(1)}h old`
    : "age unknown";
  console.log(`  ${orphan.path}  (${age})`);
}

if (!doDelete) {
  console.log(
    `\nReport only — nothing deleted. Re-run with --delete to remove orphans older than ${MIN_AGE_HOURS}h.`
  );
  process.exit(0);
}

const aged = orphans.filter((orphan) => orphan.ageHours >= MIN_AGE_HOURS);
const young = orphans.length - aged.length;
if (young > 0) {
  console.log(
    `\nSkipping ${young} orphan(s) younger than ${MIN_AGE_HOURS}h (possible in-flight uploads).`
  );
}
if (aged.length === 0) {
  console.log("Nothing old enough to delete.");
  process.exit(0);
}

// Delete in batches; report exactly what went.
for (let i = 0; i < aged.length; i += 100) {
  const batch = aged.slice(i, i + 100).map((orphan) => orphan.path);
  const { error } = await admin.storage.from(BUCKET).remove(batch);
  if (error) {
    console.error(`FAIL  delete batch failed: ${error.message}`);
    process.exit(1);
  }
  for (const path of batch) console.log(`  deleted ${path}`);
}
console.log(`\nDeleted ${aged.length} orphan(s).`);
