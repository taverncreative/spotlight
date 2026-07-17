-- RLS for client_requests: the operator reads and updates their own inbound
-- requests. Nothing else touches the table.
--
-- RECONCILIATION: already applied to prod by hand. Do NOT run against prod
-- (the policies exist); record 0040 instead. Runs for real on a fresh database.
--
-- No anon or public policy is needed, because anon has no grants on this table:
-- 0032 revoked all anon table access and set default privileges so new tables
-- inherit none. The publishable key can do nothing here even if the inbound
-- endpoint were wide open.
--
-- No insert policy is deliberate. Rows arrive only through create_client_request
-- (0041), which is SECURITY DEFINER and so runs as its owner, outside these
-- policies. Denying insert to authenticated means even a stolen operator JWT
-- cannot forge an inbound request directly.
--
-- No delete policy either: a request can be moved to 'done' but never removed,
-- so the inbound record of what was asked for is not destructible from the app.
alter table public.client_requests enable row level security;

create policy client_requests_operator_select on public.client_requests
  for select to authenticated
  using (operator_id = (select auth.uid()));

create policy client_requests_operator_update on public.client_requests
  for update to authenticated
  using (operator_id = (select auth.uid()))
  with check (operator_id = (select auth.uid()));
