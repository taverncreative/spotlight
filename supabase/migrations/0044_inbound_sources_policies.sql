-- RLS for inbound_sources: the operator manages their own senders' secrets, the
-- same operator_id predicate clients uses.
--
-- The inbound endpoint does not go through these policies. It has no session, so
-- it reads this table with service_role, which bypasses RLS. These policies are
-- what govern the operator's own management of the rows (and a future UI for
-- issuing and revoking them).
--
-- No anon policy, deliberately. anon has no grants on this table (0032), so the
-- publishable key cannot read a secret hash even though a hash would be useless
-- to it: authenticating needs the preimage, not the digest.
alter table public.inbound_sources enable row level security;

create policy inbound_sources_operator_all on public.inbound_sources
  for all to authenticated
  using (operator_id = (select auth.uid()))
  with check (operator_id = (select auth.uid()));
