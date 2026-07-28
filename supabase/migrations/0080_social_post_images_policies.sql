-- RLS for social_post_images: an image recipe is reachable only by the operator
-- who owns the post it belongs to.
--
-- owns_social_post already walks post -> client -> operator and is what
-- social_post_targets uses (0026), so this is the same one-hop check rather than
-- a second hand-rolled join that could drift from it.
alter table public.social_post_images enable row level security;

create policy social_post_images_operator_all on public.social_post_images
  for all to authenticated
  using (public.owns_social_post(post_id))
  with check (public.owns_social_post(post_id));
