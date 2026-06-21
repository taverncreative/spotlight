-- The attachments storage bucket and its tenant isolation (Phase 8, Pass 8A).
--
-- This is real application infrastructure (the bucket and its access rules must
-- exist in production too), so it lives in the migration chain, NOT in the
-- local-only reset grants (scripts/local-reset-grants.sql, which exists only to
-- restore local-stack API grants). A private bucket holds record attachments.
--
-- Path convention: every object path begins with the organisation id, then the
-- record it attaches to, then a unique object name:
--   organisation_id/related_type/related_id/<uuid>-filename
-- so the workspace is encoded in the path and storage RLS can enforce isolation
-- from the path's first segment. storage.foldername(name) returns the path's
-- folder segments, so [1] is the organisation id.
--
-- The policies let an authenticated session read, insert and delete only
-- objects whose first path segment is an organisation it belongs to, reusing
-- the recursion-safe current_user_org_ids() helper. The comparison is text to
-- text, so a malformed path simply matches nothing rather than erroring. A
-- session from one workspace can never touch another workspace's objects.
-- There is no update policy: an attachment is replaced by delete-then-insert,
-- not renamed, so updates stay denied. The service-role admin path bypasses all
-- of this, as it bypasses RLS everywhere.

insert into storage.buckets (id, name, public)
  values ('attachments', 'attachments', false)
  on conflict (id) do nothing;

create policy attachments_select_own_org on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and exists (
      select 1 from public.current_user_org_ids() as org_id
      where org_id::text = (storage.foldername(name))[1]
    )
  );

create policy attachments_insert_own_org on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and exists (
      select 1 from public.current_user_org_ids() as org_id
      where org_id::text = (storage.foldername(name))[1]
    )
  );

create policy attachments_delete_own_org on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and exists (
      select 1 from public.current_user_org_ids() as org_id
      where org_id::text = (storage.foldername(name))[1]
    )
  );
