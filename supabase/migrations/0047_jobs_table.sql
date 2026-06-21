-- Jobs table (Phase 2, Pass 1): the data layer for the Jobs module, one-off
-- scheduling. Tenant conventions as every feature table: organisation_id plus
-- the four audit columns and the shared updated_at trigger.
--
-- Like tasks and contacts (and unlike leads, customers, sites and quotes), jobs
-- carry NO deleted_at: they were never in the soft-delete set. A job that did
-- not happen is ended by the 'cancelled' status; otherwise a job hard-deletes.
--
-- Cross-table links all use the tenant-scoped composite-FK recipe (migration
-- 0011), so a job can only ever point at a customer, site or quote in its own
-- organisation:
--   - customer_id is required, ON DELETE RESTRICT (a customer with jobs cannot be
--     hard-deleted, the same guard quotes use; the GDPR erase path deletes jobs
--     before customers).
--   - site_id and quote_id are optional, ON DELETE SET NULL on the nullable
--     column only (Postgres 15+) so deleting a site or quote clears the link and
--     the job survives, never touching its NOT NULL organisation_id.
--
-- assigned_to references users(id) as a plain FK (not the composite), exactly as
-- tasks: that the assignee is an active member of this organisation is validated
-- in the action layer, not by this FK; ON DELETE SET NULL unassigns rather than
-- blocking a user delete.
--
-- Recurrence-ready, NOT built here: a job is a single occurrence. Recurrence will
-- arrive as its own pass: a job_series table carrying a repeat rule, a nullable
-- jobs.series_id composite FK into it, and per-occurrence edit/skip. That layers
-- on purely additively (an ALTER TABLE ADD COLUMN plus the new table); nothing in
-- this schema (single occurrence, hard-delete, the status set, the nullable
-- schedule) locks it out. scheduled_end is included now, unused this pass, so the
-- calendar pass that needs a start and end is additive too.

-- Add 'jobs' to the canonical module-key domain (the SQL twin of the registry in
-- lib/modules.ts). Re-create the CHECK with the new value included.
alter domain public.module_key drop constraint module_key_valid;
alter domain public.module_key add constraint module_key_valid check (
  value in (
    'leads',
    'customers',
    'quotes',
    'tasks',
    'files',
    'templates',
    'automations',
    'subscription_savings',
    'jobs'
  )
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  customer_id uuid not null,
  site_id uuid,
  quote_id uuid,
  title text not null,
  description text,
  status text not null default 'unscheduled',
  -- null while unscheduled; set when the job is scheduled. scheduled_end is
  -- reserved for the calendar pass (a start/end span) and stays null for now.
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  assigned_to uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  constraint jobs_status_check
    check (status in ('unscheduled', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  -- An end only makes sense with a start, and must come after it.
  constraint jobs_schedule_span_check
    check (
      scheduled_end is null
      or (scheduled_start is not null and scheduled_end > scheduled_start)
    ),
  -- Composite target for any future tenant-scoped reference into jobs.
  unique (organisation_id, id),
  constraint jobs_customer_id_fkey
    foreign key (organisation_id, customer_id)
    references public.customers (organisation_id, id)
    on delete restrict,
  constraint jobs_site_id_fkey
    foreign key (organisation_id, site_id)
    references public.sites (organisation_id, id)
    on delete set null (site_id),
  constraint jobs_quote_id_fkey
    foreign key (organisation_id, quote_id)
    references public.quotes (organisation_id, id)
    on delete set null (quote_id)
);

-- (organisation_id, status, scheduled_start) for the list and the later calendar
-- views; (organisation_id, assigned_to) for per-assignee views;
-- (organisation_id, customer_id) for a customer's jobs.
create index jobs_org_status_start_idx
  on public.jobs (organisation_id, status, scheduled_start);

create index jobs_org_assigned_idx
  on public.jobs (organisation_id, assigned_to);

create index jobs_org_customer_idx
  on public.jobs (organisation_id, customer_id);

create trigger set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();
