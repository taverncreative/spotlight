-- posts: the Blog CMS core. One row per blog post, scoped to a client. Body is
-- stored as Markdown (text). No external publishing here; status is the
-- internal draft/published state.
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  title text not null,
  slug text not null,
  body text,
  meta_description text,
  status text not null default 'draft'
    check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, slug)
);

create index posts_client_id_idx on public.posts (client_id);

create trigger set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();
