-- RLS for posts: every action is allowed only on posts whose client the
-- operator owns, via the shared owns_client helper (same pattern as sites).
alter table public.posts enable row level security;

create policy posts_operator_all on public.posts
  for all to authenticated
  using (public.owns_client(client_id))
  with check (public.owns_client(client_id));
