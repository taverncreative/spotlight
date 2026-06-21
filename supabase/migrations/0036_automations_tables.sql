-- Automations configuration model (Phase 10, Pass 10A): the backbone that lets a
-- workspace turn catalogue automations on or off and configure them. No engine,
-- triggering or UI this pass.
--
-- The catalogue of automation types is code-defined (lib/automations/catalogue.ts),
-- the single source of truth, so automation_type here is a plain text key into
-- that catalogue rather than a database enum; the gated actions validate the key
-- against the catalogue, and the catalogue can grow without a migration. The
-- service role is the only writer that bypasses this, and it is trusted.

-- org_automations: one row per (workspace, automation) holding its on/off state
-- and its settings. config is validated against the type's declared options in
-- the actions layer before it is written.
create table public.org_automations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  automation_type text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  -- One configuration row per automation per workspace. Also the index for the
  -- per-workspace lookup, since organisation_id is the leading column.
  unique (organisation_id, automation_type)
);

create trigger set_updated_at
  before update on public.org_automations
  for each row execute function public.set_updated_at();

-- automation_runs: an append-only log of when an automation fired and, where it
-- has a subject, against which record. The engine (a later pass) writes these;
-- this pass only creates the table. related_type/related_id are an optional
-- polymorphic subject reference with no foreign key (the same loose-link
-- contract tasks, notes and files use), both null for an automation with no
-- single subject. The index is the engine's idempotency lookup: "has this
-- automation already fired for this record in this workspace".
create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  automation_type text not null,
  related_type text,
  related_id uuid,
  fired_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id)
);

create index automation_runs_idempotency_idx
  on public.automation_runs (organisation_id, automation_type, related_type, related_id);

create trigger set_updated_at
  before update on public.automation_runs
  for each row execute function public.set_updated_at();
