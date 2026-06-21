-- Attachments maximum file size (Phase 8, Pass 8B).
--
-- Uploads go directly from the browser to storage using the user session, so
-- the bytes never pass through a server request and are not capped by a server
-- request limit. The real, unbypassable cap therefore has to live in storage
-- itself: the bucket's file_size_limit makes storage reject an oversized upload
-- before any metadata is written. recordFile additionally rejects an over-limit
-- size_bytes (see lib/files/schemas.ts MAX_FILE_SIZE_BYTES), so the metadata can
-- never claim a size the bucket would not have accepted; keep the two numbers in
-- step.
--
-- 25 MiB (26214400 bytes) is a sensible ceiling for record attachments
-- (documents, photos, PDF certificates). It sits under the local stack's global
-- storage limit (50 MiB in supabase/config.toml), so the bucket limit is the one
-- that bites.

update storage.buckets
  set file_size_limit = 26214400
  where id = 'attachments';
