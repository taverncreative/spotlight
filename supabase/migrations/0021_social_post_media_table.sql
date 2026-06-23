-- social_post_media: ordered carousel media for a post. A single photo is a
-- one-row carousel; the first row by position (0-based) is the cover. Bytes live
-- in the social-media storage bucket; storage_path is the object path. width and
-- height are optional, recorded for Meta aspect-ratio validation later.
create table public.social_post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts (id) on delete cascade,
  position integer not null,
  storage_path text not null,
  media_type text not null default 'image'
    check (media_type in ('image', 'video')),
  width integer,
  height integer,
  created_at timestamptz not null default now(),
  unique (post_id, position)
);

create index social_post_media_post_id_idx on public.social_post_media (post_id);
