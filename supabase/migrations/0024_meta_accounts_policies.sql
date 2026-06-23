-- RLS for meta_accounts: operator owns, via the shared owns_client helper (same
-- client-scoped pattern as everything else).
alter table public.meta_accounts enable row level security;

create policy meta_accounts_operator_all on public.meta_accounts
  for all to authenticated
  using (public.owns_client(client_id))
  with check (public.owns_client(client_id));
