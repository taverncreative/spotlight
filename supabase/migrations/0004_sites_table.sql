-- sites: the websites monitored under a client. Scoped to the operator via
-- client_id; deleting a client removes its sites.
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  url text not null,
  label text,
  monitoring_enabled boolean not null default true,
  check_interval_minutes integer not null default 5
    check (check_interval_minutes > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sites_client_id_idx on public.sites (client_id);

create trigger set_updated_at
  before update on public.sites
  for each row execute function public.set_updated_at();
