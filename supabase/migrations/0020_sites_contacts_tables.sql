-- Pass 5A: sites and contacts, tenant-scoped children of a customer. Both
-- follow the established tenant conventions (organisation_id plus the four
-- audit columns) and reference the customer through the tenant-scoped
-- composite recipe (migration 0011), so a child can only ever point at a
-- customer in its own organisation. They differ on delete: sites carry
-- deleted_at and soft-delete (they are in the original soft-delete set);
-- contacts have no deleted_at and hard-delete.

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  customer_id uuid not null,
  name text not null,
  address_line1 text,
  address_line2 text,
  town text,
  county text,
  postcode text,
  access_notes text,
  custom_fields jsonb not null default '{}',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  -- ON DELETE CASCADE: a customer hard-delete removes its sites. In normal
  -- use customers soft-delete; a hard-delete is the deliberate GDPR erase,
  -- gated by the quotes RESTRICT, so the erase order is quotes first, then
  -- the customer, which cascades sites and contacts (see CLAUDE.md).
  constraint sites_customer_id_fkey
    foreign key (organisation_id, customer_id)
    references public.customers (organisation_id, id)
    on delete cascade
);

create index sites_org_customer_idx
  on public.sites (organisation_id, customer_id)
  where deleted_at is null;

create trigger set_updated_at
  before update on public.sites
  for each row execute function public.set_updated_at();

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  customer_id uuid not null,
  name text not null,
  email text,
  phone text,
  job_title text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  -- Same tenant-scoped composite FK and cascade as sites. Contacts have no
  -- deleted_at: they hard-delete (not in the soft-delete set). Primary-contact
  -- uniqueness is a deliberate later decision, not enforced here.
  constraint contacts_customer_id_fkey
    foreign key (organisation_id, customer_id)
    references public.customers (organisation_id, id)
    on delete cascade
);

create index contacts_org_customer_idx
  on public.contacts (organisation_id, customer_id);

create trigger set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();
