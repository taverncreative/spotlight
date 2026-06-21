-- Files storage-path consistency guard (Phase 8, Pass 8B).
--
-- The files row records where its object lives (storage_path) in the private
-- 'attachments' bucket, whose path convention puts the organisation id first:
--   organisation_id/related_type/related_id/<uuid>-filename
-- The storage.objects RLS (migration 0030) already stops a session writing an
-- object outside its own workspace, but nothing yet stops a metadata row's
-- storage_path naming a different workspace's prefix. This CHECK closes that
-- gap at the database: a files row's storage_path must begin with its own
-- organisation_id followed by a slash, so the metadata can never point at
-- another workspace's storage prefix, whatever the application code does.
--
-- starts_with is immutable, so it is valid in a CHECK; the comparison is the
-- row's own organisation_id cast to text plus '/'. The table is empty (no
-- upload feature has shipped), so no existing row can violate this.

alter table public.files
  add constraint files_storage_path_under_org
  check (starts_with(storage_path, organisation_id::text || '/'));
