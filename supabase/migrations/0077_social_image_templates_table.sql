-- Social image templates: the look, stored as data.
--
-- A template is everything about how a photo and some words sit together --
-- type size, leading, position, scrim, highlight -- and NOT the photo or the
-- words themselves. That separation is the point: one template dresses many
-- posts, and changing it changes all of them.
--
-- THE STYLE IS jsonb, DELIBERATELY, where the rest of this schema prefers
-- columns. A template's fields are a design vocabulary, not a data model: slice
-- 3 will add controls, later slices will add alignment, a second text slot,
-- maybe a logo. Every one of those as a column means a migration to change how a
-- picture looks, which is exactly the coupling this table exists to remove.
-- lib/social/render-template.ts owns the shape (TemplateStyle) and is where a
-- new field is added; the check below only guarantees it is an object, because a
-- constraint that enumerated the keys would be the column-per-field problem
-- wearing a different hat.
--
-- CANVAS SIZE IS COLUMNS, not style. It is the one thing that is genuinely
-- structural rather than cosmetic: it decides the aspect ratio a photo is
-- cropped to and what a stored render actually is, and it is worth being able to
-- query "which templates are 4:5" without unpacking json.
--
-- operator_id, matching every other top-level table, so RLS scopes directly
-- rather than through a join.
--
-- client_id is NULLABLE and means "available to every client". BSK's look is
-- currently BSK's, but the whole reason to have templates rather than presets is
-- that a second client will want the same treatment with different words. A
-- template pinned to a client can stay pinned; one that is not is shared.
create table public.social_image_templates (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  client_id uuid references public.clients (id) on delete cascade,

  name text not null check (length(trim(name)) between 1 and 80),

  canvas_width integer not null check (canvas_width between 200 and 4096),
  canvas_height integer not null check (canvas_height between 200 and 4096),

  -- The TemplateStyle object. An object, not an array, and not null.
  style jsonb not null default '{}'::jsonb
    check (jsonb_typeof(style) = 'object'),

  -- Archived rather than deleted, because a recipe points at a template and a
  -- published post's recipe is a record of how something that is already public
  -- was made. Deleting the template would cascade that history away.
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index social_image_templates_operator_id_idx
  on public.social_image_templates (operator_id);
create index social_image_templates_client_id_idx
  on public.social_image_templates (client_id);

create trigger set_updated_at
  before update on public.social_image_templates
  for each row execute function public.set_updated_at();
