-- Class A RLS for sites and contacts, copying the established pattern: members
-- read their organisation's rows (or platform staff), and record-writing roles
-- write through the shared predicate current_user_can_write_records (migration
-- 0017), so read_only is denied. Future Class A tables use this predicate
-- directly rather than the inline role list.

alter table public.sites enable row level security;
alter table public.contacts enable row level security;

create policy sites_select_member_or_staff on public.sites
  for select to authenticated
  using (
    organisation_id in (select public.current_user_org_ids())
    or public.is_platform_staff()
  );

create policy sites_insert_writers on public.sites
  for insert to authenticated
  with check (public.current_user_can_write_records(organisation_id));

create policy sites_update_writers on public.sites
  for update to authenticated
  using (public.current_user_can_write_records(organisation_id))
  with check (public.current_user_can_write_records(organisation_id));

create policy sites_delete_writers on public.sites
  for delete to authenticated
  using (public.current_user_can_write_records(organisation_id));

create policy contacts_select_member_or_staff on public.contacts
  for select to authenticated
  using (
    organisation_id in (select public.current_user_org_ids())
    or public.is_platform_staff()
  );

create policy contacts_insert_writers on public.contacts
  for insert to authenticated
  with check (public.current_user_can_write_records(organisation_id));

create policy contacts_update_writers on public.contacts
  for update to authenticated
  using (public.current_user_can_write_records(organisation_id))
  with check (public.current_user_can_write_records(organisation_id));

create policy contacts_delete_writers on public.contacts
  for delete to authenticated
  using (public.current_user_can_write_records(organisation_id));
