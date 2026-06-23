-- RLS for social_posts: operator owns, via the shared owns_client helper (same
-- pattern as posts and sites).
alter table public.social_posts enable row level security;

create policy social_posts_operator_all on public.social_posts
  for all to authenticated
  using (public.owns_client(client_id))
  with check (public.owns_client(client_id));
