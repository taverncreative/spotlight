-- Job series table (Phase 2, recurrence pass): the repeat rule and the template
-- a recurring job's occurrences are generated from. This is the seam Pass 1
-- designed jobs around (a job is a single occurrence; this table plus a nullable
-- jobs.series_id composite FK is the planned additive layer).
--
-- Tenant conventions as every feature table: organisation_id plus the four audit
-- columns and the shared updated_at trigger. Like jobs (and tasks, contacts,
-- templates) it carries NO deleted_at: a series is hard-deleted; ending one is a
-- repeat_until / max_occurrences end or a delete, not a soft-delete.
--
-- The rule: frequency + repeat_interval (every N) + anchor_start (the first
-- occurrence instant, carrying the time of day the rule preserves) + an end. The
-- end is at most one of:
--   repeat_until      an exclusive upper bound on occurrence instants
--   max_occurrences   stop after this many occurrences
-- both null means open-ended (generated to a rolling horizon; the deployment-era
-- runner rolls it forward). A this-and-following split normalises a count-ended
-- original series onto repeat_until, so the at-most-one CHECK always holds.
--
-- generated_until records how far occurrences have been stamped, for idempotent
-- regeneration and the later runner. skipped_slots are occurrence instants that
-- were deleted "this occurrence only": regeneration must never resurrect them
-- (the calendar EXDATE idea), and they need no surviving row.
--
-- The template the occurrences inherit: title, description, customer_id, site_id,
-- assigned_to. Cross-table links use the tenant-scoped composite-FK recipe, same
-- as jobs: customer_id required ON DELETE RESTRICT (a customer with a series
-- cannot be hard-deleted, the same guard jobs/quotes use; the GDPR erase path
-- clears series and jobs before customers), site_id optional ON DELETE SET NULL
-- on the nullable column. assigned_to is a plain users FK ON DELETE SET NULL,
-- validated as an active co-member in the actions, exactly as jobs.

create table public.job_series (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  frequency text not null,
  repeat_interval integer not null default 1,
  anchor_start timestamptz not null,
  repeat_until timestamptz,
  max_occurrences integer,
  generated_until timestamptz,
  skipped_slots timestamptz[] not null default '{}',
  title text not null,
  description text,
  customer_id uuid not null,
  site_id uuid,
  assigned_to uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  constraint job_series_frequency_check
    check (frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  constraint job_series_interval_check check (repeat_interval >= 1),
  constraint job_series_max_occurrences_check
    check (max_occurrences is null or max_occurrences >= 1),
  -- At most one end kind is set (the form offers Never / On date / After N; a
  -- split normalises onto repeat_until).
  constraint job_series_end_check
    check (num_nonnulls(repeat_until, max_occurrences) <= 1),
  -- Composite target so jobs.series_id can be a tenant-scoped composite FK.
  unique (organisation_id, id),
  constraint job_series_customer_id_fkey
    foreign key (organisation_id, customer_id)
    references public.customers (organisation_id, id)
    on delete restrict,
  constraint job_series_site_id_fkey
    foreign key (organisation_id, site_id)
    references public.sites (organisation_id, id)
    on delete set null (site_id)
);

create index job_series_org_idx on public.job_series (organisation_id);

create trigger set_updated_at
  before update on public.job_series
  for each row execute function public.set_updated_at();
