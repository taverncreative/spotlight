-- meta_accounts: connected Meta publishing accounts (a Facebook Page or an
-- Instagram business account), scoped to a client. Stubbed here so the
-- social_post_targets FK is real; the Meta-connect slice will ALTER this to add
-- the encrypted token handling. Non-secret display fields only for now.
create table public.meta_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram')),
  external_id text not null,
  display_name text,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, external_id)
);

create index meta_accounts_client_id_idx on public.meta_accounts (client_id);

create trigger set_updated_at
  before update on public.meta_accounts
  for each row execute function public.set_updated_at();
