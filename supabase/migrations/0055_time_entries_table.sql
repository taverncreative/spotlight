-- time_entries: every contribution to a client's monthly retainer usage. One row
-- per contribution, of two kinds:
--
--   kind='timer'  a stopwatch session. started_at is the real start; ended_at is
--                 NULL while it runs and is filled on stop. A NULL ended_at IS
--                 the running-timer representation: server-side truth, a start
--                 with no end, so a live timer survives page refresh, browser
--                 close and laptop sleep. The browser never holds the clock.
--                 Multiple rows with ended_at IS NULL for one client are that
--                 many fully independent running stopwatches; nothing couples
--                 them and each counts its own wall time. Duration is derived,
--                 extract(epoch from ended_at - started_at), never stored.
--
--   kind='manual' an operator correction for a forgotten start/stop. It carries a
--                 signed adjust_seconds (negative to subtract) and does NOT use
--                 ended_at; a start/stop interval cannot represent a subtraction.
--                 started_at is the day/time the correction is attributed to.
--
-- Monthly usage is purely derived, no worker: rows are bucketed by started_at
-- into date_trunc('month', now()). A session spanning midnight or the 1st is
-- attributed wholly to started_at's month (agreed: one clean rule; the rare
-- boundary-spanner is fixable with a manual adjust). Unused time never rolls
-- over because last month's rows simply fall outside the current window.
--
-- Scoped to the operator via client_id, the same per-client seam as client_tasks
-- (0049); deleting a client removes its time entries.
create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  kind text not null
    check (kind in ('timer', 'manual')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  adjust_seconds int,
  note text,
  created_at timestamptz not null default now(),
  -- Shape per kind: a timer never carries a manual adjustment; a manual entry
  -- must carry a signed adjustment and never uses ended_at (its duration is the
  -- adjustment, not an interval).
  constraint time_entries_shape check (
    (kind = 'timer' and adjust_seconds is null)
    or (kind = 'manual' and adjust_seconds is not null and ended_at is null)
  ),
  -- A finished timer cannot end before it starts. Vacuously true while running
  -- (ended_at NULL) and for manual rows.
  constraint time_entries_timer_order check (
    ended_at is null or ended_at >= started_at
  ),
  constraint time_entries_note_len
    check (note is null or length(note) <= 500)
);

-- The monthly roll-up: range-scan started_at within a client and group. Covers
-- both the per-client card sum and the total bar.
create index time_entries_client_started_idx
  on public.time_entries (client_id, started_at);

-- Running timers only: a partial index so "which timers are live" stays cheap and
-- small, unaffected by the growing tail of finished rows. The predicate MUST
-- carry kind = 'timer': manual rows also have ended_at NULL (per the shape
-- constraint), so ended_at-alone would count every manual adjustment as a live
-- timer. Slice 3's running-timer query must filter on the same two predicates.
create index time_entries_running_idx
  on public.time_entries (client_id)
  where kind = 'timer' and ended_at is null;
