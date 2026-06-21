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
  templateCreateSchema,
  templateIdSchema,
  templateListSchema,
  templateUpdateSchema,
} from "@/lib/templates/schemas";

// The Templates server actions (Pass 9A). They follow the recorded action shape
// (workspace access, templates-module gate, role gate, Zod parse,
// organisation-scoped query). Managing templates is record.write for now (any
// write-capable role: staff, manager, client_admin); if we later decide
// templates are settings, the writes could be tightened to settings.manage
// (client_admin only) the way the web-form management screens are. Reads are
// record.read. No deleted_at: a template hard-deletes, and the delete is audited.

const TEMPLATE_COLUMNS =
  "id, name, category, subject, body, created_by, created_at, updated_at";

type TemplateRow = {
  id: string;
  name: string;
  category: string;
  subject: string | null;
  body: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

async function gate(orgSlug: string, capability: Capability) {
  const context = await requireWorkspaceAccess(orgSlug);
  await requireModuleEnabled(context.organisation, "templates");
  requirePermission(context.membership, capability);
  return context;
}

export async function listTemplates(orgSlug: string, input: unknown) {
  const { organisation } = await gate(orgSlug, "record.read");
  const { category } = templateListSchema.parse(input);

  const supabase = await createClient();
  let query = supabase
    .from("templates")
    .select(TEMPLATE_COLUMNS)
    .eq("organisation_id", organisation.id);
  if (category) query = query.eq("category", category);

  const { data, error } = await query
    .order("name", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data as TemplateRow[];
}

export async function getTemplate(orgSlug: string, input: unknown) {
  const { organisation } = await gate(orgSlug, "record.read");
  const { id } = templateIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .select(TEMPLATE_COLUMNS)
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as TemplateRow | null;
}

export async function createTemplate(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const fields = templateCreateSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .insert({
      name: fields.name,
      category: fields.category,
      subject: fields.subject ?? null,
      body: fields.body,
      organisation_id: organisation.id,
      created_by: user.id,
      updated_by: user.id,
    })
    .select(TEMPLATE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as TemplateRow;
}

export async function updateTemplate(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id, ...fields } = templateUpdateSchema.parse(input);

  // Only the provided keys change; undefined means "leave as is". subject is
  // normalised to null by the schema when blank, so an explicit null clears it.
  const changes: Record<string, unknown> = { updated_by: user.id };
  if (fields.name !== undefined) changes.name = fields.name;
  if (fields.category !== undefined) changes.category = fields.category;
  if (fields.subject !== undefined) changes.subject = fields.subject;
  if (fields.body !== undefined) changes.body = fields.body;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .update(changes)
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .select(TEMPLATE_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as TemplateRow | null;
}

export async function deleteTemplate(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id } = templateIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .delete()
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (data) {
    await writeAuditLog({
      organisationId: organisation.id,
      actorUserId: user.id,
      action: "template.deleted",
      targetType: "template",
      targetId: data.id,
    });
  }
  return data;
}
