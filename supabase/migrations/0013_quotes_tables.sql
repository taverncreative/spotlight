-- Pass 3A: quotes and quote_line_items, the Quotes module data layer.
-- Quotes follow the established tenant pattern (conventions, soft delete,
-- partial indexes); line items hard-delete, the quote carries the
-- recoverable soft delete. Cross-table references use the tenant-scoped
-- composite recipe from migration 0011.

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  customer_id uuid not null,
  -- site_id gains its FK when the sites table is built (see CLAUDE.md).
  site_id uuid,
  quote_number integer not null,
  title text,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'declined', 'expired')),
  issued_at timestamptz,
  valid_until date,
  subtotal_pence integer not null default 0,
  vat_pence integer not null default 0,
  total_pence integer not null default 0,
  custom_fields jsonb not null default '{}',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  unique (organisation_id, quote_number),
  -- Composite target for tenant-scoped references into quotes.
  unique (organisation_id, id),
  -- RESTRICT: a customer cannot be hard-deleted while it has quotes. The
  -- deliberate GDPR erase path deletes quotes before customers.
  constraint quotes_customer_id_fkey
    foreign key (organisation_id, customer_id)
    references public.customers (organisation_id, id)
    on delete restrict
);

create index quotes_org_status_idx
  on public.quotes (organisation_id, status)
  where deleted_at is null;

create index quotes_org_customer_idx
  on public.quotes (organisation_id, customer_id);

create trigger set_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();

create table public.quote_line_items (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  quote_id uuid not null,
  position integer not null,
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_price_pence integer not null,
  vat_rate numeric(5,2) not null default 20.00,
  line_total_pence integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  -- Hard-deleting a quote removes its lines; a soft-deleted quote keeps
  -- them.
  constraint quote_line_items_quote_id_fkey
    foreign key (organisation_id, quote_id)
    references public.quotes (organisation_id, id)
    on delete cascade
);

create index quote_line_items_quote_idx
  on public.quote_line_items (quote_id);

create trigger set_updated_at
  before update on public.quote_line_items
  for each row execute function public.set_updated_at();
