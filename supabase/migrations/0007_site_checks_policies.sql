-- Ownership helper: true when the given site belongs to a client the caller
-- owns. SECURITY DEFINER, empty search_path, joining site -> client.
create function public.owns_site(site_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.sites
    join public.clients on public.clients.id = public.sites.client_id
    where public.sites.id = site_id
      and public.clients.operator_id = (select auth.uid())
  );
$$;

-- RLS for site_checks: every action is allowed only on checks whose site the
-- operator owns (via its client).
alter table public.site_checks enable row level security;

create policy site_checks_operator_all on public.site_checks
  for all to authenticated
  using (public.owns_site(site_id))
  with check (public.owns_site(site_id));
