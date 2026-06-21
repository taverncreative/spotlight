-- Spotlight baseline spine. Squash-reset from the inherited BSK multi-tenant
-- migrations down to only what the auth/login path needs: the public.users
-- mirror of auth.users, its maintenance triggers and single-operator RLS.
-- Spotlight is single-operator, so there is no platform_role, no organisations
-- and no memberships; tenant scoping is operator_id = auth.uid() on the
-- Spotlight tables that follow.

-- users: one row per auth user, created by a trigger on auth.users insert. For
-- Spotlight this is just the operator, kept for any future per-user profile
-- fields.
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Mirror each new auth user into public.users.
create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Shared updated_at maintenance, applied to every table that has the column.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- RLS: a session sees and edits only its own row. No platform-staff branch.
alter table public.users enable row level security;

create policy users_select_self on public.users
  for select to authenticated
  using (id = (select auth.uid()));

create policy users_update_self on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- A session may only update its own full_name; id and email are managed by
-- auth. KEEP IN SYNC WITH scripts/local-reset-grants.sql.
revoke update on public.users from authenticated;
grant update (full_name) on public.users to authenticated;
