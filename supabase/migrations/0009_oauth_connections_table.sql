-- oauth_connections: provider-generic OAuth token storage for the operator.
-- access_token and refresh_token hold app-encrypted ciphertext (AES-256-GCM via
-- lib/oauth/encryption.ts), so they are text. One row per (operator, provider):
-- reconnecting a product updates that row.
create table public.oauth_connections (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  provider text not null,
  access_token text not null,
  refresh_token text,
  token_expiry timestamptz,
  scopes text[],
  account_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operator_id, provider)
);

create trigger set_updated_at
  before update on public.oauth_connections
  for each row execute function public.set_updated_at();
