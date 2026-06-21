// Admin-only config-table RLS proof. Runs against the local Supabase stack with:
// npm run test:admin-config-rls
//
// Some tables are settings, not records: their management is meant to be
// client_admin-only, and the server actions gate them on settings.manage. This
// proves that limit is enforced at the database too, not only in the actions, so
// a non-admin member cannot change them through a direct user-session query that
// bypasses the action gate (the same principle as the files-storage write-role
// tightening). It covers org_automations and webhook_forms, the two config
// tables whose actions gate on settings.manage.
//
// With real user sessions per role it shows, for each table: a staff, manager
// and read_only member is denied INSERT (a hard row-level-security error) and
// UPDATE (the policy matches no row, so nothing changes); a client_admin can do
// both; every member can still read; and even a client_admin cannot write
// another workspace's config (tenant scoping intact). The actual denials are
// printed. Cleans up after itself; exits non-zero if any assertion fails.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  console.error(
    "Missing Supabase env vars. Run via: npm run test:admin-config-rls (reads .env.local)"
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

// Renders a postgrest error the way it actually comes back, so the denial is
// shown verbatim rather than described.
function denial(error: unknown): string {
  if (!error) return "no error (unexpected success)";
  const e = error as { message?: string; code?: string; status?: number };
  return `${e.code ? `[${e.code}] ` : ""}${e.message ?? JSON.stringify(error)}`;
}

const run = crypto.randomUUID().slice(0, 8);
const password = `Test-${crypto.randomUUID()}`;
const emailFor = (label: string) => `user-${label}-${run}@admin-config.test`;

async function createOrg(label: string) {
  const { data, error } = await admin
    .from("organisations")
    .insert({ name: `Admin config ${label} ${run}`, slug: `admin-config-${label}-${run}` })
    .select("id")
    .single();
  if (error) fatal(`create org ${label}`, error.message);
  return data.id as string;
}

async function createUser(label: string, orgId: string, role: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emailFor(label),
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

async function signIn(label: string): Promise<SupabaseClient> {
  const client = createClient(url!, publishableKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: emailFor(label),
    password,
  });
  if (error) fatal(`sign in ${label}`, error.message);
  return client;
}

const orgA = await createOrg("a");
const orgB = await createOrg("b");
await createUser("admin-a", orgA, "client_admin");
await createUser("staff-a", orgA, "staff");
await createUser("manager-a", orgA, "manager");
await createUser("readonly-a", orgA, "read_only");
await createUser("admin-b", orgB, "client_admin");

// One config table to prove, described by how to make and change a row. The
// insert row is built per organisation; the update changes one field.
type ConfigTable = {
  table: string;
  insertRow: (orgId: string) => Record<string, unknown>;
  update: Record<string, unknown>;
  verifyColumn: string;
  // The stored value before the (denied) update, to confirm it did not change.
  unchangedValue: unknown;
};

const TABLES: ConfigTable[] = [
  {
    table: "org_automations",
    insertRow: (orgId) => ({
      organisation_id: orgId,
      automation_type: "lead_followup_task",
      enabled: true,
    }),
    update: { enabled: false },
    verifyColumn: "enabled",
    unchangedValue: true,
  },
  {
    table: "webhook_forms",
    insertRow: (orgId) => ({
      organisation_id: orgId,
      name: `Admin only form ${run}`,
    }),
    update: { name: `Hijacked ${run}` },
    verifyColumn: "name",
    unchangedValue: `Admin only form ${run}`,
  },
];

try {
  const clientAdminA = await signIn("admin-a");
  const clientStaffA = await signIn("staff-a");
  const clientManagerA = await signIn("manager-a");
  const clientReadonlyA = await signIn("readonly-a");
  const clientAdminB = await signIn("admin-b");

  const nonAdmins: Array<[string, SupabaseClient]> = [
    ["staff", clientStaffA],
    ["manager", clientManagerA],
    ["read_only", clientReadonlyA],
  ];

  for (const def of TABLES) {
    console.log(`\n--- ${def.table} ---`);

    // 1. Non-admins are denied INSERT with a hard row-level-security error.
    for (const [role, client] of nonAdmins) {
      const res = await client.from(def.table).insert(def.insertRow(orgA));
      check(
        `${role} is DENIED INSERT on ${def.table}`,
        res.error !== null,
        "insert unexpectedly succeeded"
      );
      console.log(`        denial (${role} insert): ${denial(res.error)}`);
    }

    // 2. A client_admin can INSERT (positive control). This is the row the
    //    update checks operate on.
    const created = await clientAdminA
      .from(def.table)
      .insert(def.insertRow(orgA))
      .select("id")
      .single();
    check(
      `client_admin can INSERT on ${def.table}`,
      created.error === null && created.data !== null,
      denial(created.error)
    );
    const rowId = created.data?.id as string;

    // 3. Members can still read the row (read access unchanged).
    const staffRead = await clientStaffA.from(def.table).select("id").eq("id", rowId);
    check(
      `a member can still SELECT ${def.table}`,
      staffRead.error === null && (staffRead.data?.length ?? 0) === 1,
      staffRead.error?.message ?? `saw ${staffRead.data?.length} rows`
    );

    // 4. Non-admins are denied UPDATE: the policy matches no row, so nothing is
    //    updated and the value is unchanged.
    for (const [role, client] of nonAdmins) {
      const upd = await client
        .from(def.table)
        .update(def.update)
        .eq("id", rowId)
        .select("id");
      check(
        `${role} UPDATE on ${def.table} changes nothing (policy matches no row)`,
        upd.error === null && (upd.data?.length ?? 0) === 0,
        upd.error ? denial(upd.error) : `unexpectedly updated ${upd.data?.length} rows`
      );
    }
    const afterNonAdmin = await admin
      .from(def.table)
      .select(def.verifyColumn)
      .eq("id", rowId)
      .single();
    check(
      `${def.table} value survived the non-admin updates`,
      (afterNonAdmin.data as unknown as Record<string, unknown>)?.[
        def.verifyColumn
      ] === def.unchangedValue,
      `value is now ${JSON.stringify(afterNonAdmin.data)}`
    );

    // 5. A client_admin can UPDATE (positive control).
    const adminUpd = await clientAdminA
      .from(def.table)
      .update(def.update)
      .eq("id", rowId)
      .select("id");
    check(
      `client_admin can UPDATE on ${def.table}`,
      adminUpd.error === null && (adminUpd.data?.length ?? 0) === 1,
      adminUpd.error ? denial(adminUpd.error) : `updated ${adminUpd.data?.length} rows`
    );

    // 6. Tenant scoping intact: even a client_admin cannot insert another
    //    workspace's config (admin-a is not an admin of organisation B).
    const crossInsert = await clientAdminA.from(def.table).insert(def.insertRow(orgB));
    check(
      `a client_admin is DENIED INSERT into another workspace's ${def.table}`,
      crossInsert.error !== null,
      "cross-tenant insert unexpectedly succeeded"
    );
    console.log(`        denial (admin-a writing into B): ${denial(crossInsert.error)}`);

    // And organisation B's admin cannot change organisation A's row.
    const crossUpd = await clientAdminB
      .from(def.table)
      .update(def.update)
      .eq("id", rowId)
      .select("id");
    check(
      `another workspace's admin cannot UPDATE this ${def.table} row`,
      crossUpd.error === null && (crossUpd.data?.length ?? 0) === 0,
      crossUpd.error ? denial(crossUpd.error) : `unexpectedly updated ${crossUpd.data?.length} rows`
    );
  }

  // --- organisations.brand_color (the column-scoped admin write path) ---
  // The branding settings write (migration 0044) opens UPDATE of brand_color to a
  // client_admin on their own organisation, via the user session and the column
  // grant, never a service-role surface. This proves: a non-admin cannot, no one
  // can touch another org's row, and even an admin cannot use the path to change
  // any other column (slug).
  console.log(`\n--- organisations.brand_color ---`);

  // A known baseline via the service role, so the checks have a value to compare.
  const baseColour = "#111111";
  const baseSet = await admin
    .from("organisations")
    .update({ brand_color: baseColour })
    .eq("id", orgA);
  if (baseSet.error) fatal("seed brand_color", baseSet.error.message);

  // 1. Non-admins UPDATE brand_color: the column is granted, but the policy
  //    matches no row, so nothing changes.
  for (const [role, client] of nonAdmins) {
    const upd = await client
      .from("organisations")
      .update({ brand_color: "#abcabc" })
      .eq("id", orgA)
      .select("id");
    check(
      `${role} UPDATE organisations.brand_color changes nothing (policy matches no row)`,
      upd.error === null && (upd.data?.length ?? 0) === 0,
      upd.error ? denial(upd.error) : `unexpectedly updated ${upd.data?.length} rows`
    );
  }
  const afterNonAdminBrand = await admin
    .from("organisations")
    .select("brand_color")
    .eq("id", orgA)
    .single();
  check(
    `organisations.brand_color survived the non-admin updates`,
    afterNonAdminBrand.data?.brand_color === baseColour,
    `value is now ${JSON.stringify(afterNonAdminBrand.data)}`
  );

  // 2. A client_admin CAN update brand_color on its own organisation.
  const adminBrand = await clientAdminA
    .from("organisations")
    .update({ brand_color: "#abcabc" })
    .eq("id", orgA)
    .select("id");
  check(
    `client_admin can UPDATE organisations.brand_color on its own org`,
    adminBrand.error === null && (adminBrand.data?.length ?? 0) === 1,
    adminBrand.error ? denial(adminBrand.error) : `updated ${adminBrand.data?.length} rows`
  );
  const afterAdminBrand = await admin
    .from("organisations")
    .select("brand_color")
    .eq("id", orgA)
    .single();
  check(
    `organisations.brand_color is now the admin's new value`,
    afterAdminBrand.data?.brand_color === "#abcabc",
    `value is now ${JSON.stringify(afterAdminBrand.data)}`
  );

  // 3. Column-scoped: even a client_admin cannot change another column (slug)
  //    through the user session; the column grant denies it (permission denied).
  const adminSlug = await clientAdminA
    .from("organisations")
    .update({ slug: `hijacked-${run}` })
    .eq("id", orgA)
    .select("id");
  check(
    `client_admin is DENIED UPDATE of organisations.slug (column not granted)`,
    adminSlug.error !== null,
    "slug update unexpectedly succeeded"
  );
  console.log(`        denial (admin slug update): ${denial(adminSlug.error)}`);
  const afterSlug = await admin
    .from("organisations")
    .select("slug")
    .eq("id", orgA)
    .single();
  check(
    `organisations.slug is unchanged after the denied update`,
    afterSlug.data?.slug === `admin-config-a-${run}`,
    `slug is now ${JSON.stringify(afterSlug.data)}`
  );

  // 4. Tenant scoping: organisation B's admin cannot change organisation A's
  //    brand_color (the policy matches no row for them).
  const crossBrand = await clientAdminB
    .from("organisations")
    .update({ brand_color: "#dddddd" })
    .eq("id", orgA)
    .select("id");
  check(
    `another workspace's admin cannot UPDATE this org's brand_color`,
    crossBrand.error === null && (crossBrand.data?.length ?? 0) === 0,
    crossBrand.error ? denial(crossBrand.error) : `unexpectedly updated ${crossBrand.data?.length} rows`
  );
  const afterCrossBrand = await admin
    .from("organisations")
    .select("brand_color")
    .eq("id", orgA)
    .single();
  check(
    `organisations.brand_color survived the cross-tenant update`,
    afterCrossBrand.data?.brand_color === "#abcabc",
    `value is now ${JSON.stringify(afterCrossBrand.data)}`
  );

  // --- organisations.logo_url (the same column-scoped admin write path) ---
  // The logo upload (migration 0046) opens UPDATE of logo_url to a client_admin
  // on their own org, exactly as brand_color. The slug denial above already
  // proves the path cannot touch any other column, so this block proves the
  // admin/non-admin/cross-tenant limits for logo_url specifically.
  console.log(`\n--- organisations.logo_url ---`);
  const logoA = "https://example.test/logos/a.png";

  for (const [role, client] of nonAdmins) {
    const upd = await client
      .from("organisations")
      .update({ logo_url: "https://example.test/logos/hijack.png" })
      .eq("id", orgA)
      .select("id");
    check(
      `${role} UPDATE organisations.logo_url changes nothing (policy matches no row)`,
      upd.error === null && (upd.data?.length ?? 0) === 0,
      upd.error ? denial(upd.error) : `unexpectedly updated ${upd.data?.length} rows`
    );
  }

  const adminLogo = await clientAdminA
    .from("organisations")
    .update({ logo_url: logoA })
    .eq("id", orgA)
    .select("id");
  check(
    `client_admin can UPDATE organisations.logo_url on its own org`,
    adminLogo.error === null && (adminLogo.data?.length ?? 0) === 1,
    adminLogo.error ? denial(adminLogo.error) : `updated ${adminLogo.data?.length} rows`
  );

  const crossLogo = await clientAdminB
    .from("organisations")
    .update({ logo_url: "https://example.test/logos/b.png" })
    .eq("id", orgA)
    .select("id");
  check(
    `another workspace's admin cannot UPDATE this org's logo_url`,
    crossLogo.error === null && (crossLogo.data?.length ?? 0) === 0,
    crossLogo.error ? denial(crossLogo.error) : `unexpectedly updated ${crossLogo.data?.length} rows`
  );
  const afterLogo = await admin
    .from("organisations")
    .select("logo_url")
    .eq("id", orgA)
    .single();
  check(
    `organisations.logo_url is the admin's value and survived the cross-tenant update`,
    afterLogo.data?.logo_url === logoA,
    `value is now ${JSON.stringify(afterLogo.data)}`
  );
} finally {
  await admin.from("organisations").delete().in("id", [orgA, orgB]);
  const { data: leftoverUsers } = await admin.auth.admin.listUsers();
  for (const u of leftoverUsers?.users ?? []) {
    if (u.email?.endsWith(`-${run}@admin-config.test`)) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\nAll admin-only config RLS assertions passed");
