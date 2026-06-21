-- RLS for clients: the operator owns every action on their own rows.
-- operator_id defaults to auth.uid() on insert, so a session can only create
-- rows it owns, and only see, edit or delete those.
alter table public.clients enable row level security;

create policy clients_operator_all on public.clients
  for all to authenticated
  using (operator_id = (select auth.uid()))
  with check (operator_id = (select auth.uid()));
