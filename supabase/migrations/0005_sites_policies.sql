-- Ownership helper: true when the given client belongs to the caller. SECURITY
-- DEFINER with an empty search_path, the same recursion-safe pattern the spine
-- uses, so the sites and site_checks policies stay a single predicate.
create function public.owns_client(client_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.clients
    where id = client_id
      and operator_id = (select auth.uid())
  );
$$;

-- RLS for sites: every action is allowed only on sites whose client the
-- operator owns.
alter table public.sites enable row level security;

create policy sites_operator_all on public.sites
  for all to authenticated
  using (public.owns_client(client_id))
  with check (public.owns_client(client_id));
