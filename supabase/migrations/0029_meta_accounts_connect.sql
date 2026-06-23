-- meta_accounts (Meta-connect slice): turn the 0023 stub into the operator-owned
-- store of connected Meta publishing accounts. Ownership moves from per-client to
-- per-operator — a connected Facebook Page / Instagram account belongs to the
-- operator's Meta login, not to one client — so:
--   * operator_id is added (defaults to auth.uid(), exactly like
--     oauth_connections);
--   * client_id becomes nullable (an account may later be associated with a
--     client) and detaches rather than cascades when a client is deleted;
--   * the encrypted Page/IG token lives here (access_token, AES-256-GCM via
--     lib/oauth/encryption — ciphertext-as-text, the same convention
--     oauth_connections uses);
--   * parent_account_id links an Instagram row to the Facebook Page it publishes
--     through (self-FK, cascades so removing a Page removes its IG children).
-- platform / external_id / display_name / token_expires_at / the
-- unique(platform, external_id) / the timestamps + trigger all stay as the stub
-- defined them. The table has only ever been a stub (no insert path existed), so
-- these alters run against an empty table.

alter table public.meta_accounts
  add column operator_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade;

alter table public.meta_accounts
  alter column client_id drop not null;

alter table public.meta_accounts
  drop constraint meta_accounts_client_id_fkey,
  add constraint meta_accounts_client_id_fkey
    foreign key (client_id) references public.clients (id) on delete set null;

-- Encrypted Page/IG access token. Nullable: an Instagram row publishes through
-- its parent Page's token, so a token here is not strictly required, though the
-- connect flow stores one on every row it writes.
alter table public.meta_accounts
  add column access_token text;

alter table public.meta_accounts
  add column parent_account_id uuid
    references public.meta_accounts (id) on delete cascade;

create index meta_accounts_operator_id_idx on public.meta_accounts (operator_id);
create index meta_accounts_parent_account_id_idx
  on public.meta_accounts (parent_account_id);
