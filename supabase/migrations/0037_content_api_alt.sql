-- Add featured_image_alt to the two published-read functions so consuming
-- sites can render proper alt text.
--
-- DROP then CREATE, not CREATE OR REPLACE: Postgres cannot change a function's
-- return type in place (42P13). Dropping discards the 0035 grants, so the full
-- revoke/grant block is re-asserted at the end. Both run in this migration's
-- single transaction, so there is no window where the API's RPCs are missing.
-- content_key_client is untouched.
--
-- Everything security-critical from 0035 is preserved verbatim: SECURITY
-- DEFINER, STABLE, set search_path = public, the hard-coded
-- status = 'published' filter, and the allowlisted column returns.

drop function public.published_posts(uuid);
drop function public.published_post(uuid, text);

create function public.published_posts(p_client_id uuid)
returns table (
  title text,
  slug text,
  meta_description text,
  featured_image text,
  featured_image_alt text,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.title, p.slug, p.meta_description, p.featured_image,
         p.featured_image_alt, p.published_at
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
    p.slug,
    p.body,
    p.meta_description,
    p.featured_image,
    p.featured_image_alt,
    p.published_at
  from public.posts p
  where p.client_id = p_client_id
    and p.slug = p_slug
    and p.status = 'published'
  limit 1;
$$;

-- Re-assert least privilege after the drop (which discarded the 0035 grants):
-- strip the implicit public EXECUTE, then grant only the calling roles.
revoke all on function public.published_posts(uuid) from public;
revoke all on function public.published_post(uuid, text) from public;

grant execute on function public.published_posts(uuid) to anon, authenticated;
grant execute on function public.published_post(uuid, text) to anon, authenticated;
