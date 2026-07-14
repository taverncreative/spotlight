-- Public content API read path. These three SECURITY DEFINER functions are the
-- ONLY door for the anon role (0032 revoked all anon table access), so each
-- hard-codes its scope and a route-handler bug cannot widen it.
--
-- published_posts / published_post return ONLY published rows and ONLY the
-- allowlisted columns (never status or internal ids); the single variant adds
-- the Markdown body. content_key_client verifies a per-client read key: it
-- returns the client_id only when the sha256 hash matches a non-revoked key
-- that belongs to the named client, and never returns the hash or the key.
--
-- All are STABLE and set an explicit search_path (blocks a definer search-path
-- hijack). The published-only filter lives here so it can never be forgotten in
-- a caller.

create function public.published_posts(p_client_id uuid)
returns table (
  title text,
  slug text,
  meta_description text,
  featured_image text,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.title, p.slug, p.meta_description, p.featured_image, p.published_at
  from public.posts p
  where p.client_id = p_client_id
    and p.status = 'published'
  order by p.published_at desc nulls last;
$$;

create function public.published_post(p_client_id uuid, p_slug text)
returns table (
  title text,
  slug text,
  body text,
  meta_description text,
  featured_image text,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.title,
    p.slug,
    p.body,
    p.meta_description,
    p.featured_image,
    p.published_at
  from public.posts p
  where p.client_id = p_client_id
    and p.slug = p_slug
    and p.status = 'published'
  limit 1;
$$;

create function public.content_key_client(p_client_slug text, p_key_hash bytea)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select k.client_id
  from public.client_api_keys k
  join public.clients c on c.id = k.client_id
  where c.slug = p_client_slug
    and k.key_hash = p_key_hash
    and k.revoked_at is null
  limit 1;
$$;

-- Least privilege: strip the implicit public EXECUTE, then grant only to the
-- roles that call these -- anon (the API's request role) and authenticated. The
-- functions' own filters do the scoping. (Local resets re-assert anon EXECUTE
-- via the blanket "grant all on all routines ... to anon" in
-- scripts/local-reset-grants.sql, so new functions are covered there already.)
revoke all on function public.published_posts(uuid) from public;
revoke all on function public.published_post(uuid, text) from public;
revoke all on function public.content_key_client(text, bytea) from public;

grant execute on function public.published_posts(uuid) to anon, authenticated;
grant execute on function public.published_post(uuid, text) to anon, authenticated;
grant execute on function public.content_key_client(text, bytea)
  to anon, authenticated;
