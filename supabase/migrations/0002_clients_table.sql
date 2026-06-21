-- clients: the agency's client records. First-class data owned by the single
-- operator, not tenants who log in. operator_id defaults to the caller's auth
-- id and is the data-isolation seam for every Spotlight table.
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  name text not null,
  slug text not null,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operator_id, slug)
);

create trigger set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();
