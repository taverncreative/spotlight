-- Class A RLS on tasks (Phase 6, Pass 6A), copying the established pattern
-- (consolidated in migration 0017, mirrored by sites and contacts in 0021):
-- members of the organisation read all of the organisation's tasks, so
-- visibility is org-wide and not restricted to the assignee; staff, manager
-- and client_admin write via the shared current_user_can_write_records
-- predicate; read_only is denied writes. The helpers are the SECURITY DEFINER
-- functions from migrations 0002 and 0017, never a direct membership join.

alter table public.tasks enable row level security;

create policy tasks_select_member_or_staff on public.tasks
  for select to authenticated
  using (
    organisation_id in (select public.current_user_org_ids())
    or public.is_platform_staff()
  );

create policy tasks_insert_writers on public.tasks
  for insert to authenticated
  with check (public.current_user_can_write_records(organisation_id));

create policy tasks_update_writers on public.tasks
  for update to authenticated
  using (public.current_user_can_write_records(organisation_id))
  with check (public.current_user_can_write_records(organisation_id));

create policy tasks_delete_writers on public.tasks
  for delete to authenticated
  using (public.current_user_can_write_records(organisation_id));
