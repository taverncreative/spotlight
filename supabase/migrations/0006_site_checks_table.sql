-- site_checks: append-only monitoring results for a site. Written by the
-- monitoring worker and the operator; never updated, so there is no updated_at.
create table public.site_checks (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  checked_at timestamptz not null default now(),
  status text not null check (status in ('up', 'down')),
  http_status integer,
  response_ms integer,
  ssl_expiry timestamptz,
  domain_expiry timestamptz
);

create index site_checks_site_id_checked_at_idx
  on public.site_checks (site_id, checked_at desc);
