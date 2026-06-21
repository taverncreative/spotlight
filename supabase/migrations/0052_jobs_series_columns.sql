-- Link jobs to a series and track per-occurrence locking (Phase 2, recurrence
-- pass). Purely additive, exactly as Pass 1 anticipated.
--
--   series_id     the series this job is an occurrence of (null for a one-off).
--                 A tenant-scoped composite FK into job_series, ON DELETE SET
--                 NULL on the nullable column so deleting a series detaches its
--                 surviving (locked/past) occurrences into standalone jobs rather
--                 than cascading them away or touching the NOT NULL
--                 organisation_id.
--   series_slot   the rule-computed instant this occurrence fills. It stays fixed
--                 even when the occurrence is detached and its scheduled_start is
--                 moved, so a series regeneration can tell the slot is taken and
--                 not duplicate it.
--   is_detached   set when an occurrence is edited or skipped "this occurrence
--                 only". A detached occurrence is LOCKED: a series-level
--                 regeneration leaves it untouched. Locked = is_detached OR status
--                 in ('completed','cancelled'); regeneration only ever deletes and
--                 re-stamps future, un-locked occurrences.
--
-- The existing jobs RLS (migration 0048) is table-wide, so it already governs
-- these columns; no policy change is needed.

alter table public.jobs add column series_id uuid;
alter table public.jobs add column series_slot timestamptz;
alter table public.jobs add column is_detached boolean not null default false;

alter table public.jobs add constraint jobs_series_id_fkey
  foreign key (organisation_id, series_id)
  references public.job_series (organisation_id, id)
  on delete set null (series_id);

-- For "this series" reads and regeneration (the occurrences of one series).
create index jobs_org_series_idx on public.jobs (organisation_id, series_id);
