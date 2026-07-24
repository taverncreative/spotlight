-- RLS for time_entries: every action is allowed only on entries whose client the
-- operator owns, reusing owns_client (0005) — the single-predicate policy shared
-- by sites (0005) and client_tasks (0050). Operator-only: authenticated +
-- owns_client, nothing else. anon has no table grants (0032), so it is closed by
-- default with no explicit deny needed.
alter table public.time_entries enable row level security;

create policy time_entries_operator_all on public.time_entries
  for all to authenticated
  using (public.owns_client(client_id))
  with check (public.owns_client(client_id));
