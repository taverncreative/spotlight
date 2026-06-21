"use server";

import { requireWorkspaceAccess } from "@/lib/workspace";
import {
  requireModuleEnabled,
  requirePermission,
  type Capability,
} from "@/lib/authorisation";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";
import { runAutomationsForLeadCreated } from "@/lib/automations/engine";
import {
  leadCreateSchema,
  leadIdSchema,
  leadListFilterSchema,
  leadUpdateSchema,
} from "@/lib/leads/schemas";

// The Leads server actions: the template every module copies. Each runs the
// standard pipeline in order (workspace access, module gate, role gate,
// Zod validation, organisation-scoped query). Denials and invalid input
// throw; data queries are explicitly scoped to the organisation even though
// RLS enforces it underneath.

const LEAD_COLUMNS =
  "id, name, email, phone, message, source, status, converted_customer_id, custom_fields, created_at, updated_at, deleted_at";

async function gate(orgSlug: string, capability: Capability) {
  const context = await requireWorkspaceAccess(orgSlug);
  await requireModuleEnabled(context.organisation, "leads");
  requirePermission(context.membership, capability);
  return context;
}

export async function listLeads(orgSlug: string, filter: unknown = {}) {
  const { organisation } = await gate(orgSlug, "record.read");
  const parsed = leadListFilterSchema.parse(filter);

  const supabase = await createClient();
  let query = supabase
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("organisation_id", organisation.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (parsed.status) {
    query = query.eq("status", parsed.status);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function listDeletedLeads(orgSlug: string) {
  const { organisation } = await gate(orgSlug, "record.read");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("organisation_id", organisation.id)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function getLead(orgSlug: string, input: unknown) {
  const { organisation } = await gate(orgSlug, "record.read");
  const { id } = leadIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createLead(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const fields = leadCreateSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .insert({
      ...fields,
      organisation_id: organisation.id,
      created_by: user.id,
      updated_by: user.id,
    })
    .select(LEAD_COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  // Fire the workspace's lead.created automations. Best-effort: a failure here
  // must not undo the lead that was just created, so it is logged and swallowed.
  // The exactly-once guarantee is the database's, not this call's.
  try {
    await runAutomationsForLeadCreated({
      organisationId: organisation.id,
      leadId: data.id,
    });
  } catch (automationError) {
    console.error("Automations engine failed for lead.created", automationError);
  }

  return data;
}

export async function updateLead(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id, ...fields } = leadUpdateSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .update({ ...fields, updated_by: user.id })
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .is("deleted_at", null)
    .select(LEAD_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function softDeleteLead(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id } = leadIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .update({ deleted_at: new Date().toISOString(), updated_by: user.id })
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (data) {
    await writeAuditLog({
      organisationId: organisation.id,
      actorUserId: user.id,
      action: "lead.soft_deleted",
      targetType: "lead",
      targetId: data.id,
    });
  }
  return data;
}

export async function restoreLead(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id } = leadIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .update({ deleted_at: null, updated_by: user.id })
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .not("deleted_at", "is", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (data) {
    await writeAuditLog({
      organisationId: organisation.id,
      actorUserId: user.id,
      action: "lead.restored",
      targetType: "lead",
      targetId: data.id,
    });
  }
  return data;
}

// Converts a lead into a customer atomically via the SECURITY INVOKER
// database function, so the caller's own RLS rules apply throughout and
// both changes happen or neither does. Conversion spans both modules, so
// both must be enabled. Returns { customerId }, { alreadyConverted: true }
// for the calm repeat case, or null when the lead is missing, deleted or
// another organisation's.
export async function convertLeadToCustomer(orgSlug: string, input: unknown) {
  const context = await requireWorkspaceAccess(orgSlug);
  await requireModuleEnabled(context.organisation, "leads");
  await requireModuleEnabled(context.organisation, "customers");
  requirePermission(context.membership, "record.write");
  const { id } = leadIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("convert_lead_to_customer", {
    lead_id: id,
  });

  if (error) {
    if (error.code === "LC409") {
      return { alreadyConverted: true as const };
    }
    if (error.code === "LC404") {
      return null;
    }
    throw new Error(error.message);
  }

  const customerId = data as string;
  await writeAuditLog({
    organisationId: context.organisation.id,
    actorUserId: context.user.id,
    action: "lead.converted",
    targetType: "lead",
    targetId: id,
    metadata: { customer_id: customerId },
  });
  return { customerId };
}
