-- Class A RLS on job_series (Phase 2, recurrence pass), copying the established
-- record pattern (consolidated in migration 0017, mirrored by jobs in 0048):
-- members of the organisation read all of the organisation's series; staff,
-- manager and client_admin write via the shared current_user_can_write_records
-- predicate; read_only is denied writes. The same jobs-module entitlement that
-- gates jobs gates recurrence, enforced in the actions layer, not here: RLS is
-- purely tenancy and the record-write role set.

alter table public.job_series enable row level security;

create policy job_series_select_member_or_staff on public.job_series
  for select to authenticated
  using (
    organisation_id in (select public.current_user_org_ids())
    or public.is_platform_staff()
  );

create policy job_series_insert_writers on public.job_series
  for insert to authenticated
  with check (public.current_user_can_write_records(organisation_id));

create policy job_series_update_writers on public.job_series
  for update to authenticated
  using (public.current_user_can_write_records(organisation_id))
  with check (public.current_user_can_write_records(organisation_id));

create policy job_series_delete_writers on public.job_series
  for delete to authenticated
  using (public.current_user_can_write_records(organisation_id));
