-- Make monitored domains operator-scoped, not client-scoped. Slice 1 modelled a
-- DMARC domain as belonging to a client, but the domains being monitored are the
-- operator's own (taverncreative.com first), which are not clients. So a domain
-- is owned by the operator directly; a client link stays available but optional.
--
-- Safe as a plain alter: dmarc_domains is empty on both local and prod (verified),
-- so the backfill is a no-op and the not-null tightening cannot fail on data.

alter table public.dmarc_domains
  add column operator_id uuid references auth.users (id) on delete cascade;

-- Backfill any pre-existing client-scoped rows to their client's operator (none
-- today, but correct if this ever runs against seeded data), then require it.
update public.dmarc_domains d
  set operator_id = c.operator_id
  from public.clients c
  where c.id = d.client_id and d.operator_id is null;

alter table public.dmarc_domains alter column operator_id set not null;
alter table public.dmarc_domains alter column client_id drop not null;

-- Uniqueness moves to the operator: a domain is unique per operator, and the
-- optional client link no longer participates.
alter table public.dmarc_domains
  drop constraint dmarc_domains_client_id_domain_key;
alter table public.dmarc_domains
  add constraint dmarc_domains_operator_domain_key unique (operator_id, domain);

create index dmarc_domains_operator_id_idx on public.dmarc_domains (operator_id);

-- RLS scopes directly on the operator now, replacing the owns_client predicate.
drop policy dmarc_domains_operator_all on public.dmarc_domains;
create policy dmarc_domains_operator_all on public.dmarc_domains
  for all to authenticated
  using (operator_id = (select auth.uid()))
  with check (operator_id = (select auth.uid()));

-- The child helper resolves domain -> operator directly, not domain -> client ->
-- operator. The four child tables are unchanged: they already scope via this
-- helper, and only its body changes.
create or replace function public.owns_dmarc_domain(p_domain_id uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1
    from public.dmarc_domains d
    where d.id = p_domain_id
      and d.operator_id = (select auth.uid())
  );
$$;
