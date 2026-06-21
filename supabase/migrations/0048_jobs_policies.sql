-- Class A RLS on jobs (Phase 2, Pass 1), copying the established record pattern
-- (consolidated in migration 0017, mirrored by tasks in 0024): members of the
-- organisation read all of the organisation's jobs, so visibility is org-wide
-- and not restricted to the assignee; staff, manager and client_admin write via
-- the shared current_user_can_write_records predicate; read_only is denied
-- writes. The helpers are the SECURITY DEFINER functions from migrations 0002 and
-- 0017, never a direct membership join.

alter table public.jobs enable row level security;

create policy jobs_select_member_or_staff on public.jobs
  for select to authenticated
  using (
    organisation_id in (select public.current_user_org_ids())
    or public.is_platform_staff()
  );

create policy jobs_insert_writers on public.jobs
  for insert to authenticated
  with check (public.current_user_can_write_records(organisation_id));

create policy jobs_update_writers on public.jobs
  for update to authenticated
  using (public.current_user_can_write_records(organisation_id))
  with check (public.current_user_can_write_records(organisation_id));

create policy jobs_delete_writers on public.jobs
  for delete to authenticated
  using (public.current_user_can_write_records(organisation_id));
