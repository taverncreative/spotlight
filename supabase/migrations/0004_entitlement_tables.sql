-- Pass 0D: plans, entitlements and the audit log.

-- The canonical module list, defined once. Both module columns below use
-- this domain, so the CHECK cannot drift between tables. Adding a module
-- means altering this domain (and, later, any TypeScript list) deliberately.
create domain public.module_key as text
  constraint module_key_valid check (
    value in (
      'leads',
      'customers',
      'quotes',
      'tasks',
      'files',
      'templates',
      'automations',
      'subscription_savings'
    )
  );

-- plans: the bundles BSK sells. Global catalogue data, no organisation_id.
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  monthly_price_pence integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

-- plan_modules: which modules a plan includes.
create table public.plan_modules (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  module public.module_key not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, module)
);

create trigger set_updated_at
  before update on public.plan_modules
  for each row execute function public.set_updated_at();

-- organisation_entitlements: the single source of truth for module access.
create table public.organisation_entitlements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  module public.module_key not null,
  source text not null check (source in ('plan', 'add_on')),
  seat_band text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  unique (organisation_id, module)
);

create trigger set_updated_at
  before update on public.organisation_entitlements
  for each row execute function public.set_updated_at();

-- organisations.plan_id was deferred in pass 0B until plans existed. It
-- records the assigned plan; entitlements remain the source of truth.
alter table public.organisations
  add column plan_id uuid references public.plans (id);

-- audit_log: security and compliance record, never shown to clients.
-- Insert-only: clients get no policies at all, and nothing updates rows.
-- No updated_at by design, per docs/schema-draft.md.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations (id) on delete set null,
  actor_user_id uuid references public.users (id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid references public.users (id)
);

create index audit_log_organisation_created_idx
  on public.audit_log (organisation_id, created_at desc);
