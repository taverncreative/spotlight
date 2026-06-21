-- Class A RLS for customers, copying the leads pattern exactly (migration
-- 0008): members read, record-writing roles write, soft-deleted rows under
-- the same policies, role checks via the SECURITY DEFINER helper only.

alter table public.customers enable row level security;

create policy customers_select_member_or_staff on public.customers
  for select to authenticated
  using (
    organisation_id in (select public.current_user_org_ids())
    or public.is_platform_staff()
  );

-- The role list mirrors record.write in lib/authorisation.ts; change the
-- two together (see the CLAUDE.md lesson).
create policy customers_insert_writers on public.customers
  for insert to authenticated
  with check (
    public.current_user_org_role(organisation_id)
      in ('staff', 'manager', 'client_admin')
  );

create policy customers_update_writers on public.customers
  for update to authenticated
  using (
    public.current_user_org_role(organisation_id)
      in ('staff', 'manager', 'client_admin')
  )
  with check (
    public.current_user_org_role(organisation_id)
      in ('staff', 'manager', 'client_admin')
  );

create policy customers_delete_writers on public.customers
  for delete to authenticated
  using (
    public.current_user_org_role(organisation_id)
      in ('staff', 'manager', 'client_admin')
  );
