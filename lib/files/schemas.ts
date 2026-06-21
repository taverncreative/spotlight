import { z } from "zod";

// Files schemas (Pass 8B). A file is bytes in the private 'attachments' bucket
// plus a metadata row attached to a record, so the polymorphic link is
// mandatory like notes: related_type and related_id are both required. The
// stored object path is built server-side from the record (prepareFileUpload),
// never chosen by the client; that the referenced record exists in the
// organisation is an application-layer check in the actions, standing in for the
// absent foreign key.

export const RELATED_TYPES = [
  "lead",
  "customer",
  "site",
  "quote",
  "job",
] as const;

// Maximum attachment size: 25 MiB. The real cap is the attachments bucket's
// file_size_limit (migration 0032), which storage enforces on the uploaded
// bytes; this constant gives recordFile a matching check so the recorded
// size_bytes can never exceed what the bucket would accept. Keep the two in sync.
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

const filename = z.string().trim().min(1, "A filename is required").max(255);

// Step one of an upload: ask the server to build the object path for a record.
// No bytes here; the browser uploads to the returned path with its own session.
export const prepareUploadSchema = z.object({
  related_type: z.enum(RELATED_TYPES),
  related_id: z.uuid(),
  filename,
});

// Step two: record the metadata for an object the browser has just uploaded.
// storage_path is the path the server handed back at step one; the action
// re-checks it sits under this record's prefix before trusting it.
export const recordFileSchema = z.object({
  related_type: z.enum(RELATED_TYPES),
  related_id: z.uuid(),
  filename,
  storage_path: z.string().min(1),
  size_bytes: z.number().int().nonnegative().max(MAX_FILE_SIZE_BYTES),
  mime_type: z.string().max(255).nullable().optional(),
});

// List a single record's files (the related pair, both required).
export const fileListSchema = z.object({
  related_type: z.enum(RELATED_TYPES),
  related_id: z.uuid(),
});

export const fileIdSchema = z.object({ id: z.uuid() });
