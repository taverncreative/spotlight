-- client_api_keys: per-client read keys for the public content API (the blog
-- content-hub). The plaintext key is never stored: only its sha256 hash (bytea,
-- computed in the app) plus a short display prefix. Multiple live keys per
-- client are allowed so a key can be rotated with an overlap window; revocation
-- is a timestamp (auditable), not a delete.
create table public.client_api_keys (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  key_hash bytea not null,
  key_prefix text not null,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create unique index client_api_keys_key_hash_idx
  on public.client_api_keys (key_hash);
create index client_api_keys_client_id_idx
  on public.client_api_keys (client_id);
