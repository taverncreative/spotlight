-- The recipe for one generated image on one social post.
--
-- A RECIPE, NOT A PICTURE. The row holds what the image is made of -- which
-- template, which photo, which words -- and the rendered PNG is a cache of that
-- recipe rather than the truth. This is what makes "change a template and
-- everything using it updates" possible at all: the render can be thrown away
-- and rebuilt, the recipe cannot.
--
-- ONE ROW PER IMAGE, not per post. A social post can carry a carousel, so
-- position orders them, exactly as social_post_media does.
--
-- overrides is a PARTIAL TemplateStyle, merged over the template's style at
-- render time. It is what lets one post nudge the text down without forking the
-- template, and it is the reason a template change still reaches this post:
-- anything not overridden still comes from the template.
--
-- HOW FAR "UPDATES EVERYTHING" REACHES, stated here because the limit is real
-- and easy to forget: a published post's image is already on Instagram and
-- Facebook, and nothing in this schema can change it. Re-rendering is for drafts
-- and scheduled posts. rendered_at against the template's updated_at is what
-- tells a later slice which renders are stale.
create table public.social_post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null
    references public.social_posts (id) on delete cascade,
  -- restrict, not cascade: deleting a template must not silently destroy the
  -- record of how a published image was made. Templates archive instead.
  template_id uuid not null
    references public.social_image_templates (id) on delete restrict,

  position integer not null default 0 check (position >= 0),

  -- Storage path in the social-media bucket, the same shape social_post_media
  -- stores. Not a URL: the bucket's public base belongs in one place in code.
  photo_path text not null check (length(photo_path) between 1 and 400),

  -- The words, newlines included. Line breaks here are editorial and are
  -- preserved exactly; the renderer never re-wraps them.
  text text not null default '' check (length(text) <= 500),

  overrides jsonb not null default '{}'::jsonb
    check (jsonb_typeof(overrides) = 'object'),

  -- The cached render. Null means never rendered; a path plus a rendered_at
  -- older than the template's updated_at means stale.
  rendered_path text check (rendered_path is null or length(rendered_path) between 1 and 400),
  rendered_at timestamptz,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (post_id, position)
);

create index social_post_images_post_id_idx
  on public.social_post_images (post_id);
create index social_post_images_template_id_idx
  on public.social_post_images (template_id);

create trigger set_updated_at
  before update on public.social_post_images
  for each row execute function public.set_updated_at();
