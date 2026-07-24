-- The client's monthly retainer allocation, in whole minutes (integers only, no
-- floats; hours are a display concern). Null means no retainer is set yet, which
-- the /time board renders as "not set" rather than as a zero allocation the
-- client is instantly over. No paired policy: clients_operator_all (0003) is a
-- table-wide `for all` on operator_id, so it already covers this column, the
-- same as blog_base_url (0038).
--
-- CAVEAT (by design, agreed): the allocation is a single current value with no
-- per-month history table. Editing it changes how EVERY month reads, past ones
-- included, because "used vs allocated" derives allocated from this live column.
-- Acceptable for a single operator whose retainers rarely change mid-stream; if
-- true history is ever needed, add a retainer_allocations(client_id, month)
-- table and read allocated from it instead.
alter table public.clients
  add column retainer_minutes int
    check (retainer_minutes is null or retainer_minutes >= 0);
