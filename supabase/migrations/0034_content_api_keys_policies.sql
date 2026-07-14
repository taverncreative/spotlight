-- RLS for client_api_keys: the operator manages only their own clients' keys,
-- via the shared owns_client helper (same pattern as posts and sites). The
-- public content API never reads this table directly -- it goes through the
-- content_key_client SECURITY DEFINER function (0035), which returns only a
-- client_id on an exact hash match and never the hash or key itself.
alter table public.client_api_keys enable row level security;

create policy client_api_keys_operator_all on public.client_api_keys
  for all
  using (public.owns_client(client_id))
  with check (public.owns_client(client_id));
