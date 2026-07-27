-- Expose structured data through the public content API, so a client site can
-- emit it as application/ld+json.
--
-- TWO added columns on the single-post endpoint:
--
--   schemas      -- the operator-authored entries from 0070.
--   client_name  -- so the composed Article can carry an author. The client's
--                   own name on the client's own site: already public, and the
--                   only client-level fact the Article needs. anon cannot read
--                   public.clients directly (0032 revoked its table grants), so
--                   this definer function is the only place the join can happen.
--
-- ONLY the single-post endpoint. published_posts is the index feed: it does not
-- return the body either, and a blog index does not emit per-post Article
-- markup. Adding schemas there would put a payload on every list response that
-- nothing reads. It is left untouched, and so is its ACL.
--
-- Article itself is NOT built here. It is composed in the route handler from
-- the columns this function already returns, for two reasons: SQL is the wrong
-- place to assemble JSON-LD that has to stay in step with Google's shape, and a
-- pure TypeScript function can be tested the way lib/posts/seo-score.ts is.
-- That composition widens nothing -- it is a transformation of data this
-- function has already decided is public.
--
-- DROP AND RECREATE, not CREATE OR REPLACE: Postgres refuses to replace a
-- function whose return type changes, and adding columns to a TABLE(...) is a
-- return type change.
--
-- RUN THIS AS ONE TRANSACTION. Inside one, other sessions keep seeing the old
-- function until commit, so a live request from businesssortedkent or
-- gem-services never finds nothing. Applied statement-by-statement there IS such
-- a window. The Supabase SQL editor does not honour begin/commit; use psql
-- --single-transaction.
--
-- ADDITIVE for both live client sites: they call the HTTP route, which hands the
-- result to NextResponse.json without mapping fields, so this is extra JSON keys
-- and nothing else.

drop function if exists public.published_post(uuid, text);

-- Unchanged from 0067 except for the join and the two added columns: still
-- SECURITY DEFINER so anon can read published posts with no table grant, still
-- STABLE, still an explicit search_path so a definer search-path hijack has
-- nothing to work with, and the published-only filter still lives here where a
-- caller cannot forget it.
--
-- The join is INNER on a not-null foreign key with on delete cascade, so it
-- cannot drop a row that the previous version would have returned.
create function public.published_post(p_client_id uuid, p_slug text)
returns table (
  title text,
  meta_title text,
  slug text,
  body text,
  meta_description text,
  excerpt text,
  featured_image text,
  featured_image_alt text,
  published_at timestamptz,
  updated_at timestamptz,
  schemas jsonb,
  client_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.title,
    p.meta_title,
    p.slug,
    p.body,
    p.meta_description,
    p.excerpt,
    p.featured_image,
    p.featured_image_alt,
    p.published_at,
    -- dateModified. Maintained by the set_updated_at trigger (0011), so it is
    -- the one honest answer to "when did this last change".
    p.updated_at,
    p.schemas,
    c.name
  from public.posts p
  join public.clients c on c.id = p.client_id
  where p.client_id = p_client_id
    and p.slug = p_slug
    and p.status = 'published'
  limit 1;
$$;

-- GRANTS: reproduced EXPLICITLY, not left to defaults.
--
-- Dropping a function drops its ACL with it, and a fresh CREATE FUNCTION grants
-- EXECUTE to PUBLIC by Postgres default, so the revoke is what stops this
-- migration quietly widening access, and the named grants are what stop it
-- quietly NARROWING it. The live ACL is anon, authenticated, postgres and
-- service_role; service_role arrived from Supabase's default privileges rather
-- than from any migration, so it is named here rather than assumed. Same
-- reasoning as 0067, which is where that was worked out.
--
-- anon EXECUTE is deliberate and load-bearing: reading published posts IS
-- public, and it is the only door anon has.
--
-- KEEP IN SYNC WITH scripts/local-reset-grants.sql, whose blanket
-- "grant all on all routines ... to anon" already covers this after a local
-- reset, as 0035 noted.
revoke all on function public.published_post(uuid, text) from public;

grant execute on function public.published_post(uuid, text)
  to anon, authenticated, service_role;
