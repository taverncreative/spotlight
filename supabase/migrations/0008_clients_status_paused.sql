-- Add 'paused' to the client status set. Slice 5's management UI introduces the
-- Paused state (Active default, plus Paused and Archived). Drop and re-add the
-- inline check constraint from 0002_clients_table.sql.
alter table public.clients drop constraint clients_status_check;

alter table public.clients
  add constraint clients_status_check
  check (status in ('active', 'paused', 'archived'));
