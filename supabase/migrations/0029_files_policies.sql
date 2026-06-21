-- Class A RLS on the files metadata table (Phase 8, Pass 8A), copied from notes
-- 0027: members of the organisation read all the organisation's file rows;
-- staff, manager and client_admin write via the shared
-- current_user_can_write_records predicate; read_only is denied writes. The
-- helpers are the SECURITY DEFINER functions from migrations 0002 and 0017,
-- never a direct membership join.
--
-- This governs the metadata table only. The stored objects are governed
-- separately by the storage.objects policies in migration 0030; the two layers
-- are independent and both must hold for a workspace's attachments to be safe.

alter table public.files enable row level security;

create policy files_select_member_or_staff on public.files
  for select to authenticated
  using (
    organisation_id in (select public.current_user_org_ids())
    or public.is_platform_staff()
  );

create policy files_insert_writers on public.files
  for insert to authenticated
  with check (public.current_user_can_write_records(organisation_id));

create policy files_update_writers on public.files
  for update to authenticated
  using (public.current_user_can_write_records(organisation_id))
  with check (public.current_user_can_write_records(organisation_id));

create policy files_delete_writers on public.files
  for delete to authenticated
  using (public.current_user_can_write_records(organisation_id));
