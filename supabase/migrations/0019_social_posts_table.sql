-- social_posts: the Social module core. One row per social post, scoped to a
-- client (owns_client). Carousel media and Meta targets are child tables
-- (social_post_media, social_post_targets). The status lifecycle and the
-- worker-claim fields (claimed_at / attempts / last_error) are baked in now even
-- though the publish worker is a later slice, so no future migration is needed.
create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  caption text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'publishing', 'published', 'failed')),
  scheduled_at timestamptz,
  published_at timestamptz,
  claimed_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index social_posts_client_id_idx on public.social_posts (client_id);

create trigger set_updated_at
  before update on public.social_posts
  for each row execute function public.set_updated_at();
