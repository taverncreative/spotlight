-- Tasks table (Phase 6, Pass 6A): the data layer for the Tasks module.
--
-- Tenant conventions as every feature table: organisation_id plus the four
-- audit columns and the shared updated_at trigger. Unlike leads, customers,
-- sites and quotes, tasks carry NO deleted_at: they were never in the
-- soft-delete set. A task is ended by the 'cancelled' status or a hard
-- delete, not by a soft-delete.
--
-- There is deliberately no 'overdue' status. Overdue is derived in queries as
-- due_at < now() while status is not 'done' or 'cancelled', and is never
-- stored.
--
-- related_type / related_id are a polymorphic link to a record (lead,
-- customer, site or quote) with NO foreign key, since the target table varies
-- by type. The CHECK enforces only that the pair is both set or both null;
-- that the referenced record exists in the same organisation is an
-- application-layer responsibility for the actions pass, not enforced here.
--
-- assigned_to references users(id) but is deliberately not a tenant-scoped
-- composite FK: that the assignee is a member of this organisation is
-- validated in the action layer later, not by this FK. ON DELETE SET NULL so
-- removing a user unassigns their tasks rather than blocking the user delete.

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'open',
  due_at timestamptz,
  assigned_to uuid references public.users (id) on delete set null,
  related_type text,
  related_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  constraint tasks_status_check
    check (status in ('open', 'in_progress', 'done', 'cancelled')),
  constraint tasks_related_type_check
    check (related_type in ('lead', 'customer', 'site', 'quote')),
  constraint tasks_related_pair_check
    check (
      (related_type is null and related_id is null)
      or (related_type is not null and related_id is not null)
    )
);

create index tasks_org_status_due_idx
  on public.tasks (organisation_id, status, due_at);

create index tasks_org_assigned_idx
  on public.tasks (organisation_id, assigned_to);

create trigger set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();
