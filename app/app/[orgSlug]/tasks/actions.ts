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
  taskCreateSchema,
  taskIdSchema,
  taskListSchema,
  taskStatusSchema,
  taskUpdateSchema,
  type RELATED_TYPES,
} from "@/lib/tasks/schemas";

// The Tasks server actions (Pass 6B). They follow the recorded action shape
// (workspace access, tasks-module gate, role gate, Zod parse, organisation-
// scoped query) and stand in for the two foreign keys the schema deliberately
// omits: the assignee must be an active member of the organisation, and the
// polymorphic link must point at a live record in the same organisation.
// Overdue is derived per task at read time, never stored.

const TASK_COLUMNS =
  "id, title, description, status, due_at, assigned_to, related_type, related_id, created_at, updated_at";

// The table each related_type points at. All four carry deleted_at, so a
// soft-deleted record is treated as gone for linking purposes.
const RELATED_TABLE: Record<(typeof RELATED_TYPES)[number], string> = {
  lead: "leads",
  customer: "customers",
  site: "sites",
  quote: "quotes",
};

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  due_at: string | null;
  assigned_to: string | null;
  related_type: string | null;
  related_id: string | null;
  created_at: string;
  updated_at: string;
};

async function gate(orgSlug: string, capability: Capability) {
  const context = await requireWorkspaceAccess(orgSlug);
  await requireModuleEnabled(context.organisation, "tasks");
  requirePermission(context.membership, capability);
  return context;
}

// Overdue is past its due_at while still open or in progress; a task with no
// due_at, or one that is done or cancelled, is never overdue.
function withOverdue(row: TaskRow) {
  const isOverdue =
    row.due_at !== null &&
    row.status !== "done" &&
    row.status !== "cancelled" &&
    new Date(row.due_at).getTime() < Date.now();
  return { ...row, isOverdue };
}

// Integrity check standing in for the absent assignee FK: the user must be an
// active member of this organisation. Members may read their organisation's
// member list (migration 0003), so the request-scoped client is enough.
async function assigneeInOrganisation(organisationId: string, userId: string) {
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

// Integrity check standing in for the absent polymorphic FK: the referenced
// record must exist in this organisation and not be soft-deleted.
async function relatedRecordExists(
  organisationId: string,
  type: (typeof RELATED_TYPES)[number],
  id: string
) {
  const supabase = await createClient();
  const { data } = await supabase
    .from(RELATED_TABLE[type])
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  return data !== null;
}

// listOrganisationMembers moved to lib/members.ts (Pass 10C): the member read is
// no longer coupled to the tasks module, so the tasks and automations assignee
// pickers share one read. The tasks pages and the tasks section import it from
// there.

export async function listTasks(orgSlug: string, input: unknown) {
  const { organisation } = await gate(orgSlug, "record.read");
  const filters = taskListSchema.parse(input);

  const supabase = await createClient();
  let query = supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("organisation_id", organisation.id);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.assigned_to) query = query.eq("assigned_to", filters.assigned_to);
  if (filters.related_type && filters.related_id) {
    query = query
      .eq("related_type", filters.related_type)
      .eq("related_id", filters.related_id);
  }
  if (filters.overdue) {
    query = query
      .lt("due_at", new Date().toISOString())
      .not("status", "in", "(done,cancelled)");
  }

  const { data, error } = await query
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as TaskRow[]).map(withOverdue);
}

export async function getTask(orgSlug: string, input: unknown) {
  const { organisation } = await gate(orgSlug, "record.read");
  const { id } = taskIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? withOverdue(data as TaskRow) : null;
}

export async function createTask(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const fields = taskCreateSchema.parse(input);

  if (
    fields.assigned_to &&
    !(await assigneeInOrganisation(organisation.id, fields.assigned_to))
  ) {
    return null;
  }
  if (
    fields.related_type &&
    fields.related_id &&
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
    .from("tasks")
    .insert({
      title: fields.title,
      description: fields.description ?? null,
      due_at: fields.due_at ?? null,
      assigned_to: fields.assigned_to ?? null,
      status: fields.status ?? "open",
      related_type: fields.related_type ?? null,
      related_id: fields.related_id ?? null,
      organisation_id: organisation.id,
      created_by: user.id,
      updated_by: user.id,
    })
    .select(TASK_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return withOverdue(data as TaskRow);
}

export async function updateTask(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id, ...fields } = taskUpdateSchema.parse(input);

  if (
    fields.assigned_to != null &&
    !(await assigneeInOrganisation(organisation.id, fields.assigned_to))
  ) {
    return null;
  }
  if (
    fields.related_type != null &&
    fields.related_id != null &&
    !(await relatedRecordExists(
      organisation.id,
      fields.related_type,
      fields.related_id
    ))
  ) {
    return null;
  }

  // Only the provided keys change; undefined means "leave as is".
  const changes: Record<string, unknown> = { updated_by: user.id };
  if (fields.title !== undefined) changes.title = fields.title;
  if (fields.description !== undefined) changes.description = fields.description;
  if (fields.due_at !== undefined) changes.due_at = fields.due_at;
  if (fields.assigned_to !== undefined) changes.assigned_to = fields.assigned_to;
  if (fields.related_type !== undefined)
    changes.related_type = fields.related_type;
  if (fields.related_id !== undefined) changes.related_id = fields.related_id;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update(changes)
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .select(TASK_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? withOverdue(data as TaskRow) : null;
}

export async function setTaskStatus(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id, status } = taskStatusSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ status, updated_by: user.id })
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .select(TASK_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? withOverdue(data as TaskRow) : null;
}

export async function deleteTask(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id } = taskIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
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
      action: "task.deleted",
      targetType: "task",
      targetId: data.id,
    });
  }
  return data;
}
