-- Pass 3B: atomic quote-number allocation. The counter lives on
-- organisations, which members cannot update directly (the column grant
-- limits user sessions to name and custom_field_definitions), so this is
-- SECURITY DEFINER with the record.write role check inside, mirroring the
-- Class A write policies. The single UPDATE .. RETURNING takes a row lock,
-- so two simultaneous allocations can never return the same number; the
-- unique (organisation_id, quote_number) constraint is the backstop.
create function public.allocate_quote_number(org_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text;
  allocated integer;
begin
  caller_role := public.current_user_org_role(org_id);
  if caller_role is null
     or caller_role not in ('staff', 'manager', 'client_admin') then
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

revoke execute on function public.allocate_quote_number(uuid)
  from public, anon;
grant execute on function public.allocate_quote_number(uuid) to authenticated;
