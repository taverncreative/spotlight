-- Co-member visibility via RLS.
--
-- The assignee picker needs the names of people in the same workspace.
-- public.users was self-only under RLS (users_select_self_or_staff), which
-- forced a service-role read (listOrganisationMembers in Pass 6C). This
-- replaces that with a database rule so the read returns to the normal user
-- session, keeping service-role to its original sanctioned set.

-- 1. A recursion-safe helper, mirroring the access helpers in migration 0002:
--    the set of user ids who share at least one active organisation with the
--    current user, the user themselves included. Like the others it is
--    SECURITY DEFINER, so it bypasses RLS inside its body and cannot trigger
--    the users or organisation_memberships policies recursively. It reuses
--    current_user_org_ids(), itself a SECURITY DEFINER helper.
create function public.current_user_co_member_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select distinct user_id
  from public.organisation_memberships
  where status = 'active'
    and organisation_id in (select public.current_user_org_ids());
$$;

-- 2. A second permissive SELECT policy on public.users, OR-combined with the
--    existing self-or-staff read: a session may also read the rows of its
--    co-members. Workspace members can therefore see each other's name, which
--    is appropriate for a team. The existing self-only read (users_select_
--    self_or_staff) and the update policy (users_update_self) are left intact.
create policy users_select_co_members on public.users
  for select to authenticated
  using (id in (select public.current_user_co_member_ids()));

-- 3. Bound the columns a user session may read from public.users to the
--    minimum the picker needs: id, full_name and email (email is the display
--    fallback when full_name is unset). platform_role and the timestamps are
--    therefore NOT exposed to co-members, only names and emails. This carve-out
--    mirrors the update carve-out from migration 0003 and, like it, MUST be
--    kept in sync with scripts/local-reset-grants.sql, whose blanket grant
--    would otherwise restore full-column SELECT on a local reset.
revoke select on public.users from authenticated;
grant select (id, full_name, email) on public.users to authenticated;
