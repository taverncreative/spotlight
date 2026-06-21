-- Class A RLS for quotes and quote_line_items, copying the established
-- pattern: members read, record-writing roles write, role checks via the
-- SECURITY DEFINER helper only.

alter table public.quotes enable row level security;
alter table public.quote_line_items enable row level security;

create policy quotes_select_member_or_staff on public.quotes
  for select to authenticated
  using (
    organisation_id in (select public.current_user_org_ids())
    or public.is_platform_staff()
  );

create policy quotes_insert_writers on public.quotes
  for insert to authenticated
  with check (
    public.current_user_org_role(organisation_id)
      in ('staff', 'manager', 'client_admin')
  );

create policy quotes_update_writers on public.quotes
  for update to authenticated
  using (
    public.current_user_org_role(organisation_id)
      in ('staff', 'manager', 'client_admin')
  )
  with check (
    public.current_user_org_role(organisation_id)
      in ('staff', 'manager', 'client_admin')
  );

create policy quotes_delete_writers on public.quotes
  for delete to authenticated
  using (
    public.current_user_org_role(organisation_id)
      in ('staff', 'manager', 'client_admin')
  );

create policy line_items_select_member_or_staff on public.quote_line_items
  for select to authenticated
  using (
    organisation_id in (select public.current_user_org_ids())
    or public.is_platform_staff()
  );

create policy line_items_insert_writers on public.quote_line_items
  for insert to authenticated
  with check (
    public.current_user_org_role(organisation_id)
      in ('staff', 'manager', 'client_admin')
  );

create policy line_items_update_writers on public.quote_line_items
  for update to authenticated
  using (
    public.current_user_org_role(organisation_id)
      in ('staff', 'manager', 'client_admin')
  )
  with check (
    public.current_user_org_role(organisation_id)
      in ('staff', 'manager', 'client_admin')
  );

create policy line_items_delete_writers on public.quote_line_items
  for delete to authenticated
  using (
    public.current_user_org_role(organisation_id)
      in ('staff', 'manager', 'client_admin')
  );
