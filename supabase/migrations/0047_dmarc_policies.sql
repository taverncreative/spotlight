-- RLS for the DMARC tables: the operator reads and manages only their own
-- domains' data. dmarc_domains scopes directly via owns_client; the four child
-- tables scope via owns_dmarc_domain (0046), which resolves domain -> client ->
-- operator.
--
-- Writes in production go through the service-role webhook (slice 2), which
-- bypasses RLS -- the same shape as the inbound-feedback path -- so these
-- policies govern the operator's READ and any operator-side management (adding a
-- monitored domain, editing known senders). anon gets nothing: 0032 already
-- leaves anon without table grants, and these enable RLS on top.

alter table public.dmarc_domains enable row level security;
create policy dmarc_domains_operator_all on public.dmarc_domains
  for all to authenticated
  using (public.owns_client(client_id))
  with check (public.owns_client(client_id));

alter table public.dmarc_known_senders enable row level security;
create policy dmarc_known_senders_operator_all on public.dmarc_known_senders
  for all to authenticated
  using (public.owns_dmarc_domain(dmarc_domain_id))
  with check (public.owns_dmarc_domain(dmarc_domain_id));

alter table public.dmarc_reports enable row level security;
create policy dmarc_reports_operator_all on public.dmarc_reports
  for all to authenticated
  using (public.owns_dmarc_domain(dmarc_domain_id))
  with check (public.owns_dmarc_domain(dmarc_domain_id));

alter table public.dmarc_report_records enable row level security;
create policy dmarc_report_records_operator_all on public.dmarc_report_records
  for all to authenticated
  using (public.owns_dmarc_domain(dmarc_domain_id))
  with check (public.owns_dmarc_domain(dmarc_domain_id));

alter table public.dmarc_daily enable row level security;
create policy dmarc_daily_operator_all on public.dmarc_daily
  for all to authenticated
  using (public.owns_dmarc_domain(dmarc_domain_id))
  with check (public.owns_dmarc_domain(dmarc_domain_id));
