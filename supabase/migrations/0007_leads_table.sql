-- Pass 1A: the leads table, the first tenant client-data table. It
-- establishes the soft-delete pattern: deleted_at set means deleted but
-- recoverable; the GDPR hard-erase path really deletes (docs/decisions.md).

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  -- These two gain foreign keys when webhook_forms and customers are built
  -- in later passes (see the CLAUDE.md lesson).
  webhook_form_id uuid,
  converted_customer_id uuid,
  name text,
  email text,
  phone text,
  message text,
  source text,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'qualified', 'converted', 'rejected', 'spam')),
  custom_fields jsonb not null default '{}',
  raw_payload jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id)
);

-- Partial indexes: normal reads only ever want active rows.
create index leads_org_status_idx
  on public.leads (organisation_id, status)
  where deleted_at is null;

create index leads_org_created_idx
  on public.leads (organisation_id, created_at desc)
  where deleted_at is null;

create trigger set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();
