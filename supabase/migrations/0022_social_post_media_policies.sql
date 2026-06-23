-- Ownership helper: true when the given social post belongs to a client the
-- caller owns. SECURITY DEFINER, empty search_path, joining post -> client
-- (mirrors owns_site). Used by the social_post_media and social_post_targets
-- policies.
create function public.owns_social_post(post_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.social_posts
    join public.clients on public.clients.id = public.social_posts.client_id
    where public.social_posts.id = post_id
      and public.clients.operator_id = (select auth.uid())
  );
$$;

-- RLS for social_post_media: every action is allowed only on media whose post
-- the operator owns (via its client).
alter table public.social_post_media enable row level security;

create policy social_post_media_operator_all on public.social_post_media
  for all to authenticated
  using (public.owns_social_post(post_id))
  with check (public.owns_social_post(post_id));
