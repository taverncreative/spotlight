-- Class A RLS on templates (Phase 9, Pass 9A), copying the established pattern
-- (consolidated in migration 0017, mirrored by notes in 0027): members of the
-- organisation read all of the organisation's templates; staff, manager and
-- client_admin write via the shared current_user_can_write_records predicate;
-- read_only is denied writes. The helpers are the SECURITY DEFINER functions
-- from migrations 0002 and 0017, never a direct membership join.
--
-- The templates-module entitlement gate is enforced in the actions layer, not
-- here: RLS is purely tenancy and the record-write role set.

alter table public.templates enable row level security;

create policy templates_select_member_or_staff on public.templates
  for select to authenticated
  using (
    organisation_id in (select public.current_user_org_ids())
    or public.is_platform_staff()
  );

create policy templates_insert_writers on public.templates
  for insert to authenticated
  with check (public.current_user_can_write_records(organisation_id));

create policy templates_update_writers on public.templates
  for update to authenticated
  using (public.current_user_can_write_records(organisation_id))
  with check (public.current_user_can_write_records(organisation_id));

create policy templates_delete_writers on public.templates
  for delete to authenticated
  using (public.current_user_can_write_records(organisation_id));
