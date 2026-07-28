-- RLS for social_post_insights: an insight is readable and writable only by the
-- operator who owns the post behind the target.
--
-- The chain is insights -> target -> post -> client -> operator. owns_social_post
-- already covers post -> client -> operator (it is what social_post_targets uses
-- in 0026), so this policy only has to get from a target_id to its post_id.
--
-- The subselect is on social_post_targets, whose own RLS does NOT apply inside a
-- policy expression -- policies are not recursive. That is why the subselect is
-- wrapped in owns_social_post rather than trusted on its own: without it, any
-- authenticated operator could read another operator's insight rows by guessing
-- a target id.
alter table public.social_post_insights enable row level security;

create policy social_post_insights_operator_all on public.social_post_insights
  for all to authenticated
  using (
    public.owns_social_post(
      (select t.post_id from public.social_post_targets t where t.id = target_id)
    )
  )
  with check (
    public.owns_social_post(
      (select t.post_id from public.social_post_targets t where t.id = target_id)
    )
  );

-- NO grant to anon. Nothing about this table is public: it is the operator's
-- view of how a client's posts performed, and the content API (0035, 0067, 0071,
-- 0073) has no business serving it. 0032 revoked anon's table grants wholesale,
-- so this is the default rather than something to undo -- stated here because
-- every other table in this schema has had that decision made explicitly.
--
-- The refresh worker writes with the SERVICE ROLE, which bypasses RLS, for the
-- same reason the deploy-hook write-back does: it runs on a cron with no
-- operator session to scope against.
