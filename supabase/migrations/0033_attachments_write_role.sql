-- Attachments storage write-role tightening (Phase 8, storage hardening).
--
-- Pass 8A gave the attachments bucket three storage.objects policies that let
-- any active member of a workspace read, insert and delete objects under that
-- workspace's path. The metadata table (files) is governed by the Class A write
-- predicate, so a read_only member cannot create a real file row, but nothing
-- stopped that same member writing orphan bytes into, or deleting real bytes
-- from, their own workspace's storage directly, bypassing the app's role gate.
--
-- This aligns storage with the app's role model: INSERT and DELETE now also
-- require a record-writing role in the organisation named by the path's first
-- segment, reusing current_user_can_write_records (the same predicate the Class
-- A table RLS uses, so storage and the tables enforce one role set). SELECT is
-- left member-level, so read_only can still read and download.
--
-- Tenant isolation is unchanged and stays as robust as 8A: the organisation is
-- still matched by comparing the path's first segment as text against the
-- caller's own active organisations, so a malformed path matches nothing rather
-- than erroring, and the write predicate is only ever evaluated against a
-- genuine membership uuid (org_id), never a cast of the untrusted path. The
-- bucket and the path convention from 8A are untouched.

alter policy attachments_insert_own_org on storage.objects
  with check (
    bucket_id = 'attachments'
    and exists (
      select 1 from public.current_user_org_ids() as org_id
      where org_id::text = (storage.foldername(name))[1]
        and public.current_user_can_write_records(org_id)
    )
  );

alter policy attachments_delete_own_org on storage.objects
  using (
    bucket_id = 'attachments'
    and exists (
      select 1 from public.current_user_org_ids() as org_id
      where org_id::text = (storage.foldername(name))[1]
        and public.current_user_can_write_records(org_id)
    )
  );
