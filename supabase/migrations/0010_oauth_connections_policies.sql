-- RLS for oauth_connections: the operator owns every action on their own rows,
-- the same operator-scoped pattern as clients. operator_id defaults to
-- auth.uid() on insert, so a session can only ever create and access its own
-- connections.
alter table public.oauth_connections enable row level security;

create policy oauth_connections_operator_all on public.oauth_connections
  for all to authenticated
  using (operator_id = (select auth.uid()))
  with check (operator_id = (select auth.uid()));
