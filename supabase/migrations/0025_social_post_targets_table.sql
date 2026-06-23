-- social_post_targets: the post -> Meta-account link (adapted from Dashoo's
-- post_platform_versions), one row per target the post publishes to, plus the
-- per-target publish record the worker fills in (published_at / platform_post_id
-- / last_error). The post's single caption is broadcast to all targets (no
-- per-target override). Left unpopulated until the Meta-connect slice adds
-- accounts.
create table public.social_post_targets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts (id) on delete cascade,
  meta_account_id uuid not null references public.meta_accounts (id) on delete cascade,
  published_at timestamptz,
  platform_post_id text,
  last_error text,
  created_at timestamptz not null default now(),
  unique (post_id, meta_account_id)
);

create index social_post_targets_post_id_idx on public.social_post_targets (post_id);
