-- Notes table (Phase 7, Pass 7A): the data layer for free-text notes.
--
-- A note is free text attached to a record. It follows the tenant conventions
-- of every feature table: organisation_id plus the four audit columns and the
-- shared updated_at trigger. Like tasks and contacts, notes carry NO
-- deleted_at: a note is ended by a permanent hard delete, not a soft-delete.
--
-- related_type / related_id are a polymorphic link to a record (lead,
-- customer, site or quote) with NO foreign key, exactly as tasks. The key
-- difference from tasks: both are NOT NULL, because a note always belongs to a
-- record (a task's link is optional, a note's is mandatory). The CHECK
-- constrains the type to the four record kinds; that the referenced record
-- actually exists in the same organisation is application-layer integrity for
-- the actions, the same loose-link contract tasks use, not enforced here.

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  body text not null,
  related_type text not null,
  related_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  constraint notes_related_type_check
    check (related_type in ('lead', 'customer', 'site', 'quote'))
);

create index notes_org_related_idx
  on public.notes (organisation_id, related_type, related_id);

create trigger set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();
