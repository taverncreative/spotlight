-- Consistency hardening: the record.write role set gets one SQL home.
-- Previously the list ('staff', 'manager', 'client_admin') was written out
-- in every Class A write policy and in the quote-number allocator; they
-- agreed by hand. After this migration the list lives in
-- record_write_roles() alone, every database enforcement point goes through
-- current_user_can_write_records(), and a test compares the database list
-- with the TypeScript capability matrix. No behaviour changes.

-- The single SQL source of the record.write role set. The companion test
-- reads this over the API and compares it with lib/capabilities.ts.
create function public.record_write_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['staff', 'manager', 'client_admin'];
$$;

-- True when the current user holds a record-writing role in the
-- organisation. Returns false (never null) for non-members.
create function public.current_user_can_write_records(org_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    public.current_user_org_role(org_id) = any (public.record_write_roles()),
    false
  );
$$;

-- Re-point every Class A write policy at the shared predicate.
alter policy leads_insert_writers on public.leads
  with check (public.current_user_can_write_records(organisation_id));
alter policy leads_update_writers on public.leads
  using (public.current_user_can_write_records(organisation_id))
  with check (public.current_user_can_write_records(organisation_id));
alter policy leads_delete_writers on public.leads
  using (public.current_user_can_write_records(organisation_id));

alter policy customers_insert_writers on public.customers
  with check (public.current_user_can_write_records(organisation_id));
alter policy customers_update_writers on public.customers
  using (public.current_user_can_write_records(organisation_id))
  with check (public.current_user_can_write_records(organisation_id));
alter policy customers_delete_writers on public.customers
  using (public.current_user_can_write_records(organisation_id));

alter policy quotes_insert_writers on public.quotes
  with check (public.current_user_can_write_records(organisation_id));
alter policy quotes_update_writers on public.quotes
  using (public.current_user_can_write_records(organisation_id))
  with check (public.current_user_can_write_records(organisation_id));
alter policy quotes_delete_writers on public.quotes
  using (public.current_user_can_write_records(organisation_id));

alter policy line_items_insert_writers on public.quote_line_items
  with check (public.current_user_can_write_records(organisation_id));
alter policy line_items_update_writers on public.quote_line_items
  using (public.current_user_can_write_records(organisation_id))
  with check (public.current_user_can_write_records(organisation_id));
alter policy line_items_delete_writers on public.quote_line_items
  using (public.current_user_can_write_records(organisation_id));

-- The allocator uses the same predicate instead of its inline list.
create or replace function public.allocate_quote_number(org_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  allocated integer;
begin
  if not public.current_user_can_write_records(org_id) then
    raise exception 'Not permitted to allocate a quote number'
      using errcode = '42501';
  end if;

  update public.organisations
    set next_quote_number = next_quote_number + 1
    where id = org_id
    returning next_quote_number - 1 into allocated;

  if allocated is null then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;

  return allocated;
end;
$$;
