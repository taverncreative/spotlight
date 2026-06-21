"use server";

import { requireWorkspaceAccess } from "@/lib/workspace";
import {
  requireModuleEnabled,
  requirePermission,
  type Capability,
} from "@/lib/authorisation";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";
import {
  AUTOMATIONS,
  getAutomation,
  isAutomationRunnable,
} from "@/lib/automations/catalogue";
import {
  buildConfigSchema,
  configInputSchema,
  setEnabledSchema,
} from "@/lib/automations/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";

// The Automations config actions (Pass 10A). They follow the recorded action
// shape gated on the automations module. Reading the catalogue merged with this
// workspace's state is record.read; enabling and configuring are settings.manage
// (client_admin only), since configuring automations is a settings
// responsibility, and both are audited. No engine, triggering or UI this pass.

const ROW_COLUMNS = "id, automation_type, enabled, config, created_at, updated_at";

type AutomationRow = {
  id: string;
  automation_type: string;
  enabled: boolean;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

async function gate(orgSlug: string, capability: Capability) {
  const context = await requireWorkspaceAccess(orgSlug);
  await requireModuleEnabled(context.organisation, "automations");
  requirePermission(context.membership, capability);
  return context;
}

// Integrity check standing in for the absent assignee FK: the user must be an
// active member of this organisation (the same check tasks use for an assignee).
async function memberOfOrganisation(organisationId: string, userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("organisation_memberships")
    .select("user_id")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return data !== null;
}

// Ensure the (workspace, automation) row exists without disturbing an existing
// one: ON CONFLICT DO NOTHING preserves its created_by and current values, and
// is race-safe against two admins acting at once. The caller then applies the
// actual change with a plain update.
async function ensureRow(
  supabase: SupabaseClient,
  organisationId: string,
  automationType: string,
  userId: string
) {
  const { error } = await supabase.from("org_automations").upsert(
    {
      organisation_id: organisationId,
      automation_type: automationType,
      created_by: userId,
      updated_by: userId,
    },
    { onConflict: "organisation_id,automation_type", ignoreDuplicates: true }
  );
  if (error) throw new Error(error.message);
}

// The catalogue merged with this workspace's enabled and config state. Catalogue
// types with no row yet read as disabled with an empty config.
export async function listAutomations(orgSlug: string) {
  const { organisation } = await gate(orgSlug, "record.read");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_automations")
    .select(ROW_COLUMNS)
    .eq("organisation_id", organisation.id);
  if (error) throw new Error(error.message);

  const byType = new Map(
    (data as AutomationRow[]).map((row) => [row.automation_type, row])
  );

  return AUTOMATIONS.map((type) => {
    const row = byType.get(type.key);
    return {
      key: type.key,
      name: type.name,
      description: type.description,
      trigger: type.trigger,
      action_kind: type.actionKind,
      runnable: isAutomationRunnable(type),
      options: type.options,
      enabled: row?.enabled ?? false,
      config: row?.config ?? {},
    };
  });
}

export async function setAutomationEnabled(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "settings.manage");
  const { automation_type, enabled } = setEnabledSchema.parse(input);

  // A type that is not yet runnable (the future email and scheduled ones) cannot
  // be enabled. The screen offers no toggle for it; this is the backstop, and
  // the engine ignores a non-runnable type even if a row said enabled.
  const type = getAutomation(automation_type)!;
  if (enabled && !isAutomationRunnable(type)) return null;

  const supabase = await createClient();
  await ensureRow(supabase, organisation.id, automation_type, user.id);
  const { data, error } = await supabase
    .from("org_automations")
    .update({ enabled, updated_by: user.id })
    .eq("organisation_id", organisation.id)
    .eq("automation_type", automation_type)
    .select(ROW_COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  await writeAuditLog({
    organisationId: organisation.id,
    actorUserId: user.id,
    action: enabled ? "automation.enabled" : "automation.disabled",
    targetType: "automation",
    targetId: data.id,
    metadata: { automation_type },
  });
  return data as AutomationRow;
}

export async function updateAutomationConfig(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "settings.manage");
  const { automation_type, config } = configInputSchema.parse(input);

  // The schema validated the key, so the catalogue entry exists. Validate the
  // config against that type's declared options (a bad day count or unknown key
  // throws a ZodError here).
  const type = getAutomation(automation_type)!;
  const parsedConfig = buildConfigSchema(type.options).parse(config) as Record<
    string,
    unknown
  >;

  // Each member-kind option, when set, must point at an active member of this
  // organisation; otherwise the config is rejected with a calm null (as a task's
  // non-member assignee is).
  for (const option of type.options) {
    if (option.kind === "member") {
      const value = parsedConfig[option.key];
      if (
        typeof value === "string" &&
        !(await memberOfOrganisation(organisation.id, value))
      ) {
        return null;
      }
    }
  }

  const supabase = await createClient();
  await ensureRow(supabase, organisation.id, automation_type, user.id);
  const { data, error } = await supabase
    .from("org_automations")
    .update({ config: parsedConfig, updated_by: user.id })
    .eq("organisation_id", organisation.id)
    .eq("automation_type", automation_type)
    .select(ROW_COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  await writeAuditLog({
    organisationId: organisation.id,
    actorUserId: user.id,
    action: "automation.configured",
    targetType: "automation",
    targetId: data.id,
    metadata: { automation_type },
  });
  return data as AutomationRow;
}
