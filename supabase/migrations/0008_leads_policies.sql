-- Class A RLS for leads: members read, record-writing roles write. This is
-- the pattern every tenant client-data table (customers, sites, quotes)
-- copies. Soft-deleted rows are governed by the same policies; deleted_at
-- filtering is a query-layer concern, never a tenancy one.

-- Role helper, same SECURITY DEFINER pattern as migration 0002: returns the
-- caller's active role in the organisation, or null. Write policies use it
-- instead of querying organisation_memberships inline.
create function public.current_user_org_role(org_id uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select role
  from public.organisation_memberships
  where organisation_id = org_id
    and user_id = (select auth.uid())
    and status = 'active';
$$;

alter table public.leads enable row level security;

create policy leads_select_member_or_staff on public.leads
  for select to authenticated
  using (
    organisation_id in (select public.current_user_org_ids())
    or public.is_platform_staff()
  );

-- The role list mirrors record.write in lib/authorisation.ts; change the
-- two together (see the CLAUDE.md lesson).
create policy leads_insert_writers on public.leads
  for insert to authenticated
  with check (
    public.current_user_org_role(organisation_id)
      in ('staff', 'manager', 'client_admin')
  );

create policy leads_update_writers on public.leads
  for update to authenticated
  using (
    public.current_user_org_role(organisation_id)
      in ('staff', 'manager', 'client_admin')
  )
  with check (
    public.current_user_org_role(organisation_id)
      in ('staff', 'manager', 'client_admin')
  );

create policy leads_delete_writers on public.leads
  for delete to authenticated
  using (
    public.current_user_org_role(organisation_id)
      in ('staff', 'manager', 'client_admin')
  );
