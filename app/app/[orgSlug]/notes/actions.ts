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
  noteCreateSchema,
  noteIdSchema,
  noteListSchema,
  noteUpdateSchema,
  type RELATED_TYPES,
} from "@/lib/notes/schemas";

// The Notes server actions (Pass 7A). They follow the recorded action shape
// (workspace access, module gate, role gate, Zod parse, organisation-scoped
// query), but the module gate is the module of the record the note is attached
// to: a customer note needs the customers module, a lead note the leads
// module, and so on. On create the polymorphic link is validated against a
// real, same-organisation, non-deleted record, the application-layer integrity
// standing in for the absent foreign key, exactly as tasks do.

type RelatedType = (typeof RELATED_TYPES)[number];

const NOTE_COLUMNS =
  "id, body, related_type, related_id, created_by, created_at, updated_at";

// The module that gates a note for each related type. Sites are part of
// customer management (they have no module of their own), so a site note is
// gated by the customers module, the same as the sites actions themselves.
const MODULE_FOR_TYPE: Record<RelatedType, string> = {
  lead: "leads",
  customer: "customers",
  site: "customers",
  quote: "quotes",
  job: "jobs",
};

// The table each related_type points at, for the existence check.
const RELATED_TABLE: Record<RelatedType, string> = {
  lead: "leads",
  customer: "customers",
  site: "sites",
  quote: "quotes",
  job: "jobs",
};

// The four CRM records soft-delete (deleted_at), so a soft-deleted record is
// treated as gone for linking. Jobs hard-delete (no deleted_at column), so the
// existence check below skips the deleted_at filter for them.
const SOFT_DELETE_TYPES = new Set<RelatedType>([
  "lead",
  "customer",
  "site",
  "quote",
]);

type NoteRow = {
  id: string;
  body: string;
  related_type: string;
  related_id: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// Gate on the module of the given related type, then the role. The caller
// resolves workspace access first (so authentication is checked before the
// input is parsed), then parses to learn the related type, then calls this.
async function gateModuleAndRole(
  context: Awaited<ReturnType<typeof requireWorkspaceAccess>>,
  relatedType: RelatedType,
  capability: Capability
) {
  await requireModuleEnabled(context.organisation, MODULE_FOR_TYPE[relatedType]);
  requirePermission(context.membership, capability);
}

// Integrity check standing in for the absent polymorphic FK: the referenced
// record must exist in this organisation and not be soft-deleted.
async function relatedRecordExists(
  organisationId: string,
  type: RelatedType,
  id: string
) {
  const supabase = await createClient();
  let query = supabase
    .from(RELATED_TABLE[type])
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("id", id);
  if (SOFT_DELETE_TYPES.has(type)) query = query.is("deleted_at", null);
  const { data } = await query.maybeSingle();
  return data !== null;
}

export async function listNotes(orgSlug: string, input: unknown) {
  const context = await requireWorkspaceAccess(orgSlug);
  const { related_type, related_id } = noteListSchema.parse(input);
  await gateModuleAndRole(context, related_type, "record.read");
  const { organisation } = context;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_COLUMNS)
    .eq("organisation_id", organisation.id)
    .eq("related_type", related_type)
    .eq("related_id", related_id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data as NoteRow[];
}

export async function createNote(orgSlug: string, input: unknown) {
  const context = await requireWorkspaceAccess(orgSlug);
  const fields = noteCreateSchema.parse(input);
  await gateModuleAndRole(context, fields.related_type, "record.write");
  const { organisation, user } = context;

  if (
    !(await relatedRecordExists(
      organisation.id,
      fields.related_type,
      fields.related_id
    ))
  ) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes")
    .insert({
      body: fields.body,
      related_type: fields.related_type,
      related_id: fields.related_id,
      organisation_id: organisation.id,
      created_by: user.id,
      updated_by: user.id,
    })
    .select(NOTE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as NoteRow;
}

// A read used by update and delete to learn the note's related type (so the
// right module gates the write) before touching it. Organisation-scoped, so a
// note in another organisation reads as absent.
async function readNote(organisationId: string, id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_COLUMNS)
    .eq("organisation_id", organisationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as NoteRow | null;
}

export async function updateNote(orgSlug: string, input: unknown) {
  const context = await requireWorkspaceAccess(orgSlug);
  const { id, body } = noteUpdateSchema.parse(input);

  // The write-role gate runs before the note is read, so read_only is denied
  // any write regardless of whether the note exists (as tasks do). The module
  // gate needs the note's type, so it follows the read.
  requirePermission(context.membership, "record.write");
  const note = await readNote(context.organisation.id, id);
  if (!note) return null;
  await requireModuleEnabled(
    context.organisation,
    MODULE_FOR_TYPE[note.related_type as RelatedType]
  );

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes")
    .update({ body, updated_by: context.user.id })
    .eq("organisation_id", context.organisation.id)
    .eq("id", id)
    .select(NOTE_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as NoteRow | null;
}

export async function deleteNote(orgSlug: string, input: unknown) {
  const context = await requireWorkspaceAccess(orgSlug);
  const { id } = noteIdSchema.parse(input);

  requirePermission(context.membership, "record.write");
  const note = await readNote(context.organisation.id, id);
  if (!note) return null;
  await requireModuleEnabled(
    context.organisation,
    MODULE_FOR_TYPE[note.related_type as RelatedType]
  );

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes")
    .delete()
    .eq("organisation_id", context.organisation.id)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (data) {
    await writeAuditLog({
      organisationId: context.organisation.id,
      actorUserId: context.user.id,
      action: "note.deleted",
      targetType: "note",
      targetId: data.id,
    });
  }
  return data;
}
