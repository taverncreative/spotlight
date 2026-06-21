// The role capability matrix: the single TypeScript source of truth for
// what each organisation role may do. Deliberately dependency-free so the
// role-consistency test can import it outside Next.js; lib/authorisation.ts
// re-exports it for app code. The record.write set has a database twin,
// record_write_roles() in migration 0017, and npm run
// test:role-consistency asserts the two are identical.
export const CAPABILITIES = {
  "record.read": ["read_only", "staff", "manager", "client_admin"],
  "record.write": ["staff", "manager", "client_admin"],
  "settings.manage": ["client_admin"],
  "users.manage": ["client_admin"],
} as const;

export type Capability = keyof typeof CAPABILITIES;
