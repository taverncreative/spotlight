-- Allow notes and files to attach to a job (Phase 2, Pass 1). The job detail
-- page carries the per-record notes and files sections, the same as leads,
-- customers and quotes, so the polymorphic related_type CHECK on both tables
-- gains 'job'. The link stays a polymorphic pair with no foreign key (the target
-- table varies by type, the deliberate exception set by tasks); the actions
-- still validate that the referenced record exists in the organisation.
--
-- Note: jobs hard-delete (no deleted_at), unlike the other four related types,
-- so the actions' existence check skips the deleted_at filter for 'job'.

alter table public.notes drop constraint notes_related_type_check;
alter table public.notes add constraint notes_related_type_check
  check (related_type in ('lead', 'customer', 'site', 'quote', 'job'));

alter table public.files drop constraint files_related_type_check;
alter table public.files add constraint files_related_type_check
  check (related_type in ('lead', 'customer', 'site', 'quote', 'job'));
