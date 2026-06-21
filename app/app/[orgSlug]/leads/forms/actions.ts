"use server";

import { randomBytes } from "node:crypto";
import { requireWorkspaceAccess } from "@/lib/workspace";
import {
  requireModuleEnabled,
  requirePermission,
  type Capability,
} from "@/lib/authorisation";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";
import {
  webhookFormCreateSchema,
  webhookFormIdSchema,
  webhookFormStatusSchema,
} from "@/lib/lead-webhooks/schemas";

// Form-management actions, part of the leads module. webhook_forms is a Class
// B table: members may read the list, but only client_admin (settings.manage)
// may create, enable or disable a form, or regenerate its token. The public
// ingestion endpoint (Pass 4A) is unaffected; it reads forms via the service
// role. There is no hard delete this pass: disabling retires a form and is
// reversible, so a form's leads keep their link.

const FORM_COLUMNS = "id, name, status, token, created_at, updated_at";

async function gate(orgSlug: string, capability: Capability) {
  const context = await requireWorkspaceAccess(orgSlug);
  await requireModuleEnabled(context.organisation, "leads");
  requirePermission(context.membership, capability);
  return context;
}

export async function listWebhookForms(orgSlug: string) {
  const { organisation } = await gate(orgSlug, "record.read");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("webhook_forms")
    .select(FORM_COLUMNS)
    .eq("organisation_id", organisation.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function createWebhookForm(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "settings.manage");
  const fields = webhookFormCreateSchema.parse(input);

  // The token column has a strong database default, so we never set it here.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("webhook_forms")
    .insert({
      organisation_id: organisation.id,
      name: fields.name,
      created_by: user.id,
      updated_by: user.id,
    })
    .select(FORM_COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  await writeAuditLog({
    organisationId: organisation.id,
    actorUserId: user.id,
    action: "webhook_form.created",
    targetType: "webhook_form",
    targetId: data.id,
  });
  return data;
}

export async function setWebhookFormStatus(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "settings.manage");
  const { id, status } = webhookFormStatusSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("webhook_forms")
    .update({ status, updated_by: user.id })
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .select(FORM_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  await writeAuditLog({
    organisationId: organisation.id,
    actorUserId: user.id,
    action: "webhook_form.status_changed",
    targetType: "webhook_form",
    targetId: data.id,
    metadata: { status },
  });
  return data;
}

export async function regenerateWebhookFormToken(
  orgSlug: string,
  input: unknown
) {
  const { organisation, user } = await gate(orgSlug, "settings.manage");
  const { id } = webhookFormIdSchema.parse(input);

  // A fresh token immediately invalidates the old link, the same 32 random
  // URL-safe bytes the public quote token uses.
  const token = randomBytes(32).toString("base64url");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("webhook_forms")
    .update({ token, updated_by: user.id })
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .select(FORM_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  await writeAuditLog({
    organisationId: organisation.id,
    actorUserId: user.id,
    action: "webhook_form.token_regenerated",
    targetType: "webhook_form",
    targetId: data.id,
  });
  return data;
}
