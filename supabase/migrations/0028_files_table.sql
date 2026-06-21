-- Files table (Phase 8, Pass 8A): metadata for attachments stored in the
-- private 'attachments' bucket. The stored object lives in storage; this row
-- records where it is and what it is, attached to a record the same loose way
-- notes are. No upload, download or delete is built this pass; this is the
-- data foundation, set up alongside the storage isolation proof before any
-- transfer is built.
--
-- related_type / related_id are a polymorphic link (lead, customer, site or
-- quote) with NO foreign key, both NOT NULL like notes (a file always attaches
-- to a record). No deleted_at: files hard-delete, and removing the stored
-- object is the delete action's job in a later pass. storage_path is the unique
-- object path in the bucket, whose first segment is the organisation id.

create table public.files (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  related_type text not null,
  related_id uuid not null,
  filename text not null,
  storage_path text not null unique,
  size_bytes bigint not null,
  mime_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  constraint files_related_type_check
    check (related_type in ('lead', 'customer', 'site', 'quote'))
);

create index files_org_related_idx
  on public.files (organisation_id, related_type, related_id);

create trigger set_updated_at
  before update on public.files
  for each row execute function public.set_updated_at();
