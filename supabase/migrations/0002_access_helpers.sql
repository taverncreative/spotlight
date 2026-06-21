-- Recursion-safe access helpers.
--
-- Why these exist: an RLS policy cannot query its own table inline. A policy
-- on organisation_memberships that asks "is this user a member" by selecting
-- from organisation_memberships triggers that table's own policies again and
-- Postgres aborts with infinite recursion (42P17). The same applies to a
-- policy on users that checks users.platform_role. SECURITY DEFINER functions
-- run as their owner, which bypasses RLS inside the function body, so they
-- break the cycle. Every future tenant table's policies must call these
-- helpers instead of joining organisation_memberships directly.

create function public.current_user_org_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select organisation_id
  from public.organisation_memberships
  where user_id = (select auth.uid())
    and status = 'active';
$$;

create function public.is_org_admin(org_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.organisation_memberships
    where organisation_id = org_id
      and user_id = (select auth.uid())
      and role = 'client_admin'
      and status = 'active'
  );
$$;

create function public.is_platform_staff()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.users
    where id = (select auth.uid())
      and platform_role in ('super_admin', 'bsk_support')
  );
$$;
