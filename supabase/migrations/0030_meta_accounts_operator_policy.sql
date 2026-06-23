-- RLS for meta_accounts now that it is operator-owned: replace the client-scoped
-- policy (owns_client) with the operator-scoped predicate oauth_connections uses.
-- operator_id defaults to auth.uid() on insert, so a session can only ever create
-- and see its own connected accounts. The social_post_targets policy is
-- unaffected — it gates on owns_social_post(post_id) (post -> client -> operator),
-- independent of how meta_accounts is owned.
drop policy meta_accounts_operator_all on public.meta_accounts;

create policy meta_accounts_operator_all on public.meta_accounts
  for all to authenticated
  using (operator_id = (select auth.uid()))
  with check (operator_id = (select auth.uid()));
