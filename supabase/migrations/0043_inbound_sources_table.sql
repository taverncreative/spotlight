-- inbound_sources: per-sender secrets for the inbound request endpoint. One row
-- per live secret; GEM CRM is the first sender.
--
-- Mirrors client_api_keys (0033) deliberately, so there is one way to hold a
-- secret in this codebase rather than two:
--   * the plaintext secret is NEVER stored, only its sha256 hash (bytea,
--     computed in the app) plus a short display prefix so the operator can tell
--     two secrets apart without holding either;
--   * revocation is a timestamp, not a delete, so it stays auditable;
--   * several live rows per source_app are allowed, which is what makes rotation
--     possible with an overlap window: issue the new secret, let the sender cut
--     over, then revoke the old one. Without that, rotating means coordinated
--     downtime with the sender.
--
-- source_app is authoritative here, not in the request body. The endpoint
-- resolves the secret to a row and passes THAT source_app to
-- create_client_request, so a sender cannot label its requests as another app.
--
-- The endpoint reads this table with service_role (it has no session), so RLS is
-- for the operator's own management of the rows. anon gets nothing: 0032 revoked
-- all anon table access and set default privileges so new tables inherit none.
create table public.inbound_sources (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references auth.users (id) on delete cascade,
  source_app text not null,
  secret_hash bytea not null,
  secret_prefix text not null,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint inbound_sources_source_app_len
    check (length(source_app) between 1 and 64),
  constraint inbound_sources_secret_prefix_len
    check (length(secret_prefix) between 1 and 16),
  constraint inbound_sources_label_len
    check (label is null or length(label) <= 200)
);

-- Unique across every row, revoked ones included, so a retired secret can never
-- be reissued. This index also serves the endpoint's only hot query:
--   select source_app from inbound_sources
--   where secret_hash = $1 and revoked_at is null
create unique index inbound_sources_secret_hash_idx
  on public.inbound_sources (secret_hash);

create index inbound_sources_operator_id_idx
  on public.inbound_sources (operator_id);
