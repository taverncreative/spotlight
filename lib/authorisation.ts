import { createClient } from "@/lib/supabase/server";
import { CAPABILITIES, type Capability } from "@/lib/capabilities";

// The capability matrix lives in lib/capabilities.ts (dependency-free for
// the role-consistency test); re-exported here for app code.
export { CAPABILITIES, type Capability };

// Denials are thrown, not returned, so a gate can never be ignored by
// accident. Callers that want a 403 catch this one error type.
export class AuthorisationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorisationError";
  }
}

// True when the membership role maps to the capability. An unknown role is
// denied, never allowed by default. Use for showing or hiding controls; the
// courtesy check only, never the enforcement.
export function hasPermission(
  membership: { role: string },
  capability: Capability
) {
  const allowedRoles: readonly string[] = CAPABILITIES[capability];
  return allowedRoles.includes(membership.role);
}

// Allows when the membership role maps to the capability, throws otherwise.
export function requirePermission(
  membership: { role: string },
  capability: Capability
) {
  if (!hasPermission(membership, capability)) {
    throw new AuthorisationError(
      `Role ${membership.role} is not permitted ${capability}`
    );
  }
}

// True when the organisation has an entitlement row for the module, from
// any source (plan or add_on). The caller has already passed
// requireWorkspaceAccess, so RLS lets this read the organisation's rows.
// Use for showing or hiding controls; requireModuleEnabled is the
// enforcement.
export async function isModuleEnabled(
  organisation: { id: string },
  module: string
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organisation_entitlements")
    .select("id")
    .eq("organisation_id", organisation.id)
    .eq("module", module)
    .maybeSingle();
  return !error && data !== null;
}

// Allows only when the organisation has an entitlement row for the module,
// throws otherwise.
export async function requireModuleEnabled(
  organisation: { id: string },
  module: string
) {
  if (!(await isModuleEnabled(organisation, module))) {
    throw new AuthorisationError(
      `Module ${module} is not enabled for this organisation`
    );
  }
}
