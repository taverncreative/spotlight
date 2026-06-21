-- RLS for the multi-tenant spine. Every table gets RLS enabled; no table is
-- left open. The service role bypasses RLS and is the platform admin path.

alter table public.users enable row level security;
alter table public.organisations enable row level security;
alter table public.organisation_memberships enable row level security;

-- users: read your own row; platform staff read all. Update only your own
-- row, and only full_name (email is maintained by auth, platform_role is set
-- only via the service role; the column grant below enforces that).
create policy users_select_self_or_staff on public.users
  for select to authenticated
  using (id = (select auth.uid()) or public.is_platform_staff());

create policy users_update_self on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Column-level update carve-out. KEEP IN SYNC WITH
-- scripts/local-reset-grants.sql: that local-reset helper re-applies these
-- same carve-outs after its blanket grant, so if this list changes, change it
-- there too (see CLAUDE.md). The carve-out below for organisations is the same
-- contract.
revoke update on public.users from authenticated;
grant update (full_name) on public.users to authenticated;

-- organisations: members read their own organisation. client_admin may
-- update it, but the column grant restricts user sessions to name and
-- custom_field_definitions (the carve-out). Platform staff have full policy
-- access; their full-column writes go through the service role admin path.
create policy organisations_select_member_or_staff on public.organisations
  for select to authenticated
  using (
    id in (select public.current_user_org_ids())
    or public.is_platform_staff()
  );

create policy organisations_update_admin_or_staff on public.organisations
  for update to authenticated
  using (public.is_org_admin(id) or public.is_platform_staff())
  with check (public.is_org_admin(id) or public.is_platform_staff());

create policy organisations_insert_staff on public.organisations
  for insert to authenticated
  with check (public.is_platform_staff());

create policy organisations_delete_staff on public.organisations
  for delete to authenticated
  using (public.is_platform_staff());

revoke update on public.organisations from authenticated;
grant update (name, custom_field_definitions) on public.organisations
  to authenticated;

-- organisation_memberships: members read the member list of organisations
-- they belong to; client_admin and platform staff manage rows. Policies use
-- the helpers, never a self-join, to avoid recursion.
create policy memberships_select_member_or_staff
  on public.organisation_memberships
  for select to authenticated
  using (
    organisation_id in (select public.current_user_org_ids())
    or public.is_platform_staff()
  );

create policy memberships_insert_admin_or_staff
  on public.organisation_memberships
  for insert to authenticated
  with check (
    public.is_org_admin(organisation_id) or public.is_platform_staff()
  );

create policy memberships_update_admin_or_staff
  on public.organisation_memberships
  for update to authenticated
  using (
    public.is_org_admin(organisation_id) or public.is_platform_staff()
  )
  with check (
    public.is_org_admin(organisation_id) or public.is_platform_staff()
  );

create policy memberships_delete_admin_or_staff
  on public.organisation_memberships
  for delete to authenticated
  using (
    public.is_org_admin(organisation_id) or public.is_platform_staff()
  );
