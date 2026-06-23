-- RLS for social_post_targets: every action is allowed only on targets whose
-- post the operator owns (via its client), using the shared owns_social_post
-- helper.
alter table public.social_post_targets enable row level security;

create policy social_post_targets_operator_all on public.social_post_targets
  for all to authenticated
  using (public.owns_social_post(post_id))
  with check (public.owns_social_post(post_id));
