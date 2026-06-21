-- Templates table (Phase 9, Pass 9A): reusable subject-and-body message content
-- with {{placeholder}} tokens, later filled from a record's data and used by
-- Automations and manual sends. No sending and no UI this pass.
--
-- It follows the tenant conventions of every feature table: organisation_id plus
-- the four audit columns and the shared updated_at trigger. Like tasks, notes
-- and contacts, templates carry NO deleted_at: a template is ended by a
-- permanent hard delete.
--
-- category organises templates into a small labelled set. It is deliberately not
-- load-bearing (automations reference a template by id, never by category), but
-- the CHECK keeps the set clean and lets a later UI offer a known list. The set
-- is mirrored by TEMPLATE_CATEGORIES in lib/templates/schemas.ts; extend the two
-- together, the same way the module_key domain and the module registry move
-- together. subject is nullable (the email subject line); body is the message
-- text and is required.

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name text not null,
  category text not null,
  subject text,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  constraint templates_category_check
    check (
      category in (
        'lead_acknowledgement',
        'quote_sent',
        'quote_chase',
        'task_reminder',
        'general'
      )
    )
);

create index templates_org_category_idx
  on public.templates (organisation_id, category);

create trigger set_updated_at
  before update on public.templates
  for each row execute function public.set_updated_at();
