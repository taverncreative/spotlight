-- RLS for client_tasks: every action is allowed only on tasks whose client the
-- operator owns, reusing owns_client (0005) — the same single-predicate policy
-- as sites. Operator-only: authenticated + owns_client, nothing else. anon has
-- no grants (0032), so it is closed by default with no explicit deny needed.
alter table public.client_tasks enable row level security;

create policy client_tasks_operator_all on public.client_tasks
  for all to authenticated
  using (public.owns_client(client_id))
  with check (public.owns_client(client_id));
