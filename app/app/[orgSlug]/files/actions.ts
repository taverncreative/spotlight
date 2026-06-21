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
  fileIdSchema,
  fileListSchema,
  prepareUploadSchema,
  recordFileSchema,
  type RELATED_TYPES,
} from "@/lib/files/schemas";

// The Files server actions (Pass 8B). A file is bytes in the private
// 'attachments' bucket plus a metadata row attached to a record. Uploads go
// directly from the browser to storage on the user session (so the storage RLS
// enforces tenant isolation and the size is not capped by a server request
// limit); these actions build the object path from the record, write and read
// the metadata, hand back short-lived signed download URLs, and remove a file.
// They follow the recorded action shape, but the module gate is the module of
// the record the file is attached to, exactly as notes are.
//
// Consistency invariant: an object exists before its metadata row, and a row is
// removed before its object. So the only inconsistent state ever reachable is a
// harmless orphaned object (an upload never recorded, or a delete whose object
// removal failed), never a row pointing at a missing object. The path order is:
//   prepareFileUpload (build path) -> browser uploads -> recordFile (write row)
//   deleteFile: remove row -> remove object.

type RelatedType = (typeof RELATED_TYPES)[number];

const BUCKET = "attachments";

// Short-lived signed download URL lifetime, in seconds.
const DOWNLOAD_URL_TTL_SECONDS = 60;

const FILE_COLUMNS =
  "id, filename, size_bytes, mime_type, related_type, related_id, created_by, created_at";

// The module that gates a file for each related type. Sites are part of customer
// management (no module of their own), so a site file is gated by the customers
// module, the same mapping notes use.
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

// The CRM records soft-delete; jobs hard-delete (no deleted_at), so the
// existence check skips the deleted_at filter for them.
const SOFT_DELETE_TYPES = new Set<RelatedType>([
  "lead",
  "customer",
  "site",
  "quote",
]);

type FileRow = {
  id: string;
  filename: string;
  size_bytes: number;
  mime_type: string | null;
  related_type: string;
  related_id: string;
  created_by: string | null;
  created_at: string;
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

// Builds the object path for an upload. The path is derived entirely from the
// record (organisation, type, id) plus a server-minted uuid, never chosen by
// the client, so the metadata cannot be steered at another record's or
// workspace's prefix. The original filename is sanitised for the path; the
// unaltered filename is kept in the metadata for display.
function buildStoragePath(
  organisationId: string,
  type: RelatedType,
  id: string,
  filename: string
) {
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${organisationId}/${type}/${id}/${crypto.randomUUID()}-${safeName}`;
}

// Step one of an upload. Validates the record and hands back the object path the
// browser should upload to with its own session. record.write, so read_only
// cannot obtain an upload path.
export async function prepareFileUpload(orgSlug: string, input: unknown) {
  const context = await requireWorkspaceAccess(orgSlug);
  const fields = prepareUploadSchema.parse(input);
  await gateModuleAndRole(context, fields.related_type, "record.write");
  const { organisation } = context;

  if (
    !(await relatedRecordExists(
      organisation.id,
      fields.related_type,
      fields.related_id
    ))
  ) {
    return null;
  }

  return {
    bucket: BUCKET,
    storage_path: buildStoragePath(
      organisation.id,
      fields.related_type,
      fields.related_id,
      fields.filename
    ),
  };
}

// Step two of an upload: record the metadata for an object the browser has just
// uploaded. record.write, gated by the related record's module. Re-validates
// the record, then that storage_path sits under this record's own prefix (the
// database CHECK in migration 0031 backstops the organisation segment; this
// check also ties the path to the claimed record). Audited.
export async function recordFile(orgSlug: string, input: unknown) {
  const context = await requireWorkspaceAccess(orgSlug);
  const fields = recordFileSchema.parse(input);
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

  // The path must be one this record would own: organisation/type/id/...
  const prefix = `${organisation.id}/${fields.related_type}/${fields.related_id}/`;
  if (!fields.storage_path.startsWith(prefix)) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("files")
    .insert({
      organisation_id: organisation.id,
      related_type: fields.related_type,
      related_id: fields.related_id,
      filename: fields.filename,
      storage_path: fields.storage_path,
      size_bytes: fields.size_bytes,
      mime_type: fields.mime_type ?? null,
      created_by: user.id,
      updated_by: user.id,
    })
    .select(FILE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  await writeAuditLog({
    organisationId: organisation.id,
    actorUserId: user.id,
    action: "file.created",
    targetType: "file",
    targetId: data.id,
    metadata: {
      related_type: fields.related_type,
      related_id: fields.related_id,
      filename: fields.filename,
      size_bytes: fields.size_bytes,
    },
  });

  return data as FileRow;
}

export async function listFiles(orgSlug: string, input: unknown) {
  const context = await requireWorkspaceAccess(orgSlug);
  const { related_type, related_id } = fileListSchema.parse(input);
  await gateModuleAndRole(context, related_type, "record.read");
  const { organisation } = context;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("files")
    .select(FILE_COLUMNS)
    .eq("organisation_id", organisation.id)
    .eq("related_type", related_type)
    .eq("related_id", related_id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data as FileRow[];
}

// A read used by download and delete to learn the file's related type (so the
// right module gates) and its storage_path. Organisation-scoped, so a file in
// another organisation reads as absent.
async function readFile(organisationId: string, id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("files")
    .select("id, related_type, storage_path")
    .eq("organisation_id", organisationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; related_type: string; storage_path: string } | null;
}

// Produces a short-lived signed download URL on the user session, so the storage
// RLS confirms the caller may read that object (a cross-tenant caller is denied
// at storage, and would not even find the row). record.read, so read_only can
// download. No new service-role surface.
export async function createFileDownloadUrl(orgSlug: string, input: unknown) {
  const context = await requireWorkspaceAccess(orgSlug);
  const { id } = fileIdSchema.parse(input);

  const file = await readFile(context.organisation.id, id);
  if (!file) return null;
  await gateModuleAndRole(
    context,
    file.related_type as RelatedType,
    "record.read"
  );

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(file.storage_path, DOWNLOAD_URL_TTL_SECONDS);
  if (error) throw new Error(error.message);
  return { signedUrl: data.signedUrl };
}

// Removes a file. record.write, audited. The row goes first, then the object,
// both on the user session and deliberately not in one transaction: ordered so
// the worst case is a harmless orphaned object rather than a row pointing at a
// missing file. A storage removal failure therefore does not fail the action
// (the authoritative metadata is already gone, the user's intent satisfied); it
// just leaves an orphan to be swept later.
export async function deleteFile(orgSlug: string, input: unknown) {
  const context = await requireWorkspaceAccess(orgSlug);
  const { id } = fileIdSchema.parse(input);

  // The write-role gate runs before the file is read, so read_only is denied
  // any delete regardless of whether the file exists (as notes behave). The
  // module gate needs the file's type, so it follows the read.
  requirePermission(context.membership, "record.write");
  const file = await readFile(context.organisation.id, id);
  if (!file) return null;
  await requireModuleEnabled(
    context.organisation,
    MODULE_FOR_TYPE[file.related_type as RelatedType]
  );

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("files")
    .delete()
    .eq("organisation_id", context.organisation.id)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  await writeAuditLog({
    organisationId: context.organisation.id,
    actorUserId: context.user.id,
    action: "file.deleted",
    targetType: "file",
    targetId: data.id,
    metadata: { storage_path: file.storage_path },
  });

  // Best-effort object removal after the row is gone. An error here leaves a
  // harmless orphan; it must not turn a successful delete into a failure.
  await supabase.storage.from(BUCKET).remove([file.storage_path]);

  return data;
}
