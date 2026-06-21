-- Pass 0B: the multi-tenant spine. Conventions per docs/schema-draft.md.

-- users: mirror of auth.users, one row per person, created by a trigger
-- on auth.users insert. platform_role marks BSK staff; most rows are null.
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  platform_role text check (platform_role in ('super_admin', 'bsk_support')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

-- organisations: one row per client workspace. plan_id arrives with the
-- plans table in a later pass.
create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  custom_field_definitions jsonb not null default '{}',
  next_quote_number integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id)
);

-- organisation_memberships: who belongs to which workspace, with what role.
create table public.organisation_memberships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null
    check (role in ('client_admin', 'manager', 'staff', 'read_only')),
  status text not null default 'invited'
    check (status in ('invited', 'active', 'disabled')),
  invited_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  unique (organisation_id, user_id)
);

create index organisation_memberships_user_id_idx
  on public.organisation_memberships (user_id);

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

create trigger set_updated_at
  before update on public.organisations
  for each row execute function public.set_updated_at();

create trigger set_updated_at
  before update on public.organisation_memberships
  for each row execute function public.set_updated_at();
