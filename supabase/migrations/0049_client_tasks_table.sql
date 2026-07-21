-- client_tasks: the operator's own per-client operational to-do list. Unlike
-- client_requests (inbound, from other apps, never operator-authored), these are
-- John's tasks ABOUT a client — "update the review schema quarterly", "check GMB
-- posts aren't running low". Scoped to the operator via client_id, the same
-- per-client seam as sites; deleting a client removes its tasks.
--
-- Recurrence is roll-forward in place: one row per recurring task. Completing a
-- recurring task advances due_date by the interval and leaves it open, so the
-- row always shows the next occurrence. A 'none' task is completed by moving it
-- to 'done'. The advance is computed by the completeTask server action, not the
-- database, so this migration stays a plain additive table with no functions.
create table public.client_tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  title text not null,
  notes text,
  due_date date,
  status text not null default 'open'
    check (status in ('open', 'done')),
  recurrence text not null default 'none'
    check (recurrence in ('none', 'weekly', 'monthly', 'quarterly', 'yearly')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_tasks_title_len
    check (length(title) between 1 and 200),
  constraint client_tasks_notes_len
    check (notes is null or length(notes) <= 5000),
  -- A recurring task needs an anchor date to roll forward from; a one-off need
  -- not have one.
  constraint client_tasks_recur_needs_due
    check (recurrence = 'none' or due_date is not null)
);

-- Due-soonest-first within a client, open tasks the common filter. due_date ASC
-- puts NULLs last by default, so undated one-offs sort below the dated ones.
create index client_tasks_client_due_idx
  on public.client_tasks (client_id, status, due_date);

create trigger set_updated_at
  before update on public.client_tasks
  for each row execute function public.set_updated_at();
