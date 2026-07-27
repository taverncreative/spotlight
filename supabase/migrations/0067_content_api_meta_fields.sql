-- Expose meta_title and excerpt (0066) through the public content API.
--
-- Two client sites read these endpoints today, businesssortedkent and
-- gem-services, both confirmed live in the request logs. A field the editor
-- stores but these functions do not return is invisible to them however well it
-- is filled in, because 0035's whole design is that the returned columns are
-- hard-coded here and a route-handler bug cannot widen them.
--
-- The change is ADDITIVE for those sites. They call the HTTP routes, not these
-- functions, and both routes hand the RPC result straight to NextResponse.json
-- without mapping fields, so two extra columns are two extra JSON keys. A
-- template that reads the fields it wants is unaffected.
--
-- DROP AND RECREATE, not CREATE OR REPLACE: Postgres refuses to replace a
-- function whose return type changes, and adding a column to a TABLE(...) is a
-- return type change. RUN THIS AS ONE TRANSACTION. Inside one, other sessions
-- keep seeing the old function until commit, so there is no window where a live
-- request from either client site finds nothing. Applied statement-by-statement
-- there IS such a window.

drop function if exists public.published_posts(uuid);
drop function if exists public.published_post(uuid, text);

-- Unchanged from 0035 except for the two added columns: still SECURITY DEFINER
-- so anon can read published posts without any table grant (0032 revoked those),
-- still STABLE, still an explicit search_path so a definer search-path hijack has
-- nothing to work with, and the published-only filter still lives here where a
-- caller cannot forget it.
create function public.published_posts(p_client_id uuid)
returns table (
  title text,
  meta_title text,
  slug text,
  meta_description text,
  excerpt text,
  featured_image text,
  featured_image_alt text,
  published_at timestamptz
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
    p.meta_description,
    p.excerpt,
    p.featured_image,
    p.featured_image_alt,
    p.published_at
  from public.posts p
  where p.client_id = p_client_id
    and p.status = 'published'
  order by p.published_at desc nulls last;
$$;

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
  published_at timestamptz
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
    p.published_at
  from public.posts p
  where p.client_id = p_client_id
    and p.slug = p_slug
    and p.status = 'published'
  limit 1;
$$;

-- GRANTS: reproduced EXPLICITLY, not left to defaults.
--
-- Dropping a function drops its ACL with it, and a fresh CREATE FUNCTION grants
-- EXECUTE to PUBLIC by Postgres default, so the revokes below are what stop this
-- migration quietly widening access.
--
-- The grants are what stop it quietly NARROWING access, which is the subtler
-- risk. The live ACL before this migration was anon, authenticated, postgres and
-- service_role. 0035 only ever granted anon and authenticated: service_role
-- arrived from Supabase's default privileges at creation time. Replaying 0035's
-- two grant lines alone would therefore have dropped service_role, and relying
-- on those defaults still applying is relying on something no migration in this
-- repo controls. All three are named here so the end state is the same whatever
-- the defaults happen to be.
--
-- anon EXECUTE is deliberate and load-bearing: reading published posts IS
-- public, and it is the only door anon has, since 0032 revoked every anon table
-- grant. Contrast create_client_request (0042) and create_print_order (0059),
-- which are write paths and are closed to anon for exactly the same reason this
-- one is open.
--
-- KEEP IN SYNC WITH scripts/local-reset-grants.sql, whose blanket
-- "grant all on all routines ... to anon" already covers these after a local
-- reset, as 0035 noted.
revoke all on function public.published_posts(uuid) from public;
revoke all on function public.published_post(uuid, text) from public;

grant execute on function public.published_posts(uuid)
  to anon, authenticated, service_role;
grant execute on function public.published_post(uuid, text)
  to anon, authenticated, service_role;
