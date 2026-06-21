-- Class A RLS on notes (Phase 7, Pass 7A), copying the established pattern
-- (consolidated in migration 0017, mirrored by tasks in 0024): members of the
-- organisation read all of the organisation's notes; staff, manager and
-- client_admin write via the shared current_user_can_write_records predicate;
-- read_only is denied writes. The helpers are the SECURITY DEFINER functions
-- from migrations 0002 and 0017, never a direct membership join.
--
-- The per-record module gate (a customer note needs the customers module, a
-- lead note the leads module, and so on) is enforced in the actions layer, not
-- here: RLS is purely tenancy and the record-write role set.

alter table public.notes enable row level security;

create policy notes_select_member_or_staff on public.notes
  for select to authenticated
  using (
    organisation_id in (select public.current_user_org_ids())
    or public.is_platform_staff()
  );

create policy notes_insert_writers on public.notes
  for insert to authenticated
  with check (public.current_user_can_write_records(organisation_id));

create policy notes_update_writers on public.notes
  for update to authenticated
  using (public.current_user_can_write_records(organisation_id))
  with check (public.current_user_can_write_records(organisation_id));

create policy notes_delete_writers on public.notes
  for delete to authenticated
  using (public.current_user_can_write_records(organisation_id));
