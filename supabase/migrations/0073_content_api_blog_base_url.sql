-- Expose clients.blog_base_url through the single-post content API, so the
-- route can build og:url.
--
-- ONE added column, from the join that 0071 already introduced for client_name.
-- No new join, no new table, no new storage.
--
-- WHY THIS SHIPS INERT. blog_base_url is null on all ten clients, including the
-- five with published posts, so og:url will be omitted for every post today.
-- That is the point: the alternative is guessing a post's public URL from
-- sites.url, and a site URL does not say whether posts live at /slug or
-- /blog/slug. A wrong og:url is worse than an absent one -- absent means the
-- crawler uses the URL it fetched, which is right by default, whereas wrong
-- means every share of every post points somewhere that may not exist.
--
-- So this exposes the field rather than inventing it, and filling blog_base_url
-- in on a client turns og:url on for that client with no further deploy.
--
-- DROP AND RECREATE, not CREATE OR REPLACE: adding a column to a TABLE(...) is a
-- return type change, which Postgres refuses to replace.
--
-- RUN THIS AS ONE TRANSACTION. Inside one, other sessions keep seeing the old
-- function until commit, so a live request from businesssortedkent or
-- gem-services never finds nothing. The Supabase SQL editor does not honour
-- begin/commit; use psql --single-transaction.
--
-- ADDITIVE for both live client sites: the route consumes this field to build
-- the og object and drops it from the response, exactly as it already does with
-- client_name and updated_at, so their JSON gains an og object and nothing else.

drop function if exists public.published_post(uuid, text);

-- Unchanged from 0071 except for the one added column. Still SECURITY DEFINER so
-- anon can read published posts with no table grant, still STABLE, still an
-- explicit search_path, and the published-only filter still lives here where a
-- caller cannot forget it.
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
  client_name text,
  blog_base_url text
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
    p.updated_at,
    p.schemas,
    c.name,
    c.blog_base_url
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
-- widening access and the named grants are what stop it narrowing. The live ACL
-- is anon, authenticated, postgres and service_role; service_role came from
-- Supabase's default privileges rather than any migration, so it is named here
-- rather than assumed. Same reasoning as 0067, where that was worked out.
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
