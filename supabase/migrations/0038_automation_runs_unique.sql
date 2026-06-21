-- Automations engine idempotency (Phase 10, Pass 10B). The engine claims a run
-- by inserting an automation_runs row before it acts; this UNIQUE constraint
-- makes that claim the exactly-once gate, so a once-per-record event automation
-- can never fire twice for the same record. A second event for the same lead
-- finds the row already present and is a clean no-op.
--
-- This key is for once-per-record event automations. Recurring or scheduled
-- automations, added later, will fire more than once per record and so will
-- need a richer run key (for example one that includes the occurrence or window);
-- they will not rely on this exact constraint. The 10A idempotency index covered
-- the same columns non-uniquely; the unique constraint supersedes it (its own
-- index serves the lookup), so the old index is dropped. The table has never
-- been written to, so there is nothing to conflict.

drop index if exists public.automation_runs_idempotency_idx;

alter table public.automation_runs
  add constraint automation_runs_once_per_record_key
  unique (organisation_id, automation_type, related_type, related_id);
