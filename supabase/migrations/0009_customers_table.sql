-- Pass 2A: the customers table, second tenant client-data table, following
-- the leads pattern (tenant conventions, soft delete, partial indexes).

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name text not null,
  type text not null default 'business'
    check (type in ('business', 'individual')),
  email text,
  phone text,
  address_line1 text,
  address_line2 text,
  town text,
  county text,
  postcode text,
  custom_fields jsonb not null default '{}',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id)
);

create index customers_org_name_idx
  on public.customers (organisation_id, name)
  where deleted_at is null;

create trigger set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- The foreign key deferred in pass 1A, added now its target exists. A lead
-- loses its conversion link only if a customer is ever hard-deleted, which
-- in normal use never happens (customers soft-delete).
alter table public.leads
  add constraint leads_converted_customer_id_fkey
  foreign key (converted_customer_id)
  references public.customers (id)
  on delete set null;
