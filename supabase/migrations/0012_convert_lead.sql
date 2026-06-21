-- Pass 2F: atomic lead-to-customer conversion. One transaction creates the
-- customer and marks the lead converted, or neither happens.
--
-- SECURITY INVOKER, deliberately: the function runs as the calling user, so
-- the existing RLS rules still decide what they can read and write. A user
-- who cannot insert customers or update leads cannot convert, and a failure
-- at any step rolls the whole transaction back.
--
-- Signals via custom SQLSTATEs so the action can map them calmly:
--   LC404: lead not found (missing, deleted, or another organisation's)
--   LC409: lead already converted (status or link already set)
create function public.convert_lead_to_customer(lead_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  the_lead public.leads%rowtype;
  new_customer_id uuid;
begin
  -- FOR UPDATE locks the row so two simultaneous conversions cannot both
  -- proceed; under RLS it also requires the caller to pass the update
  -- policy, so read_only users are stopped here even calling directly.
  select * into the_lead
    from public.leads
    where id = lead_id
      and deleted_at is null
    for update;

  if not found then
    raise exception 'Lead not found' using errcode = 'LC404';
  end if;

  if the_lead.status = 'converted'
     or the_lead.converted_customer_id is not null then
    raise exception 'Lead already converted' using errcode = 'LC409';
  end if;

  insert into public.customers
    (organisation_id, name, email, phone, created_by, updated_by)
  values (
    the_lead.organisation_id,
    coalesce(the_lead.name, 'Unnamed lead'),
    the_lead.email,
    the_lead.phone,
    (select auth.uid()),
    (select auth.uid())
  )
  returning id into new_customer_id;

  update public.leads
    set status = 'converted',
        converted_customer_id = new_customer_id,
        updated_by = (select auth.uid())
    where id = lead_id;

  return new_customer_id;
end;
$$;
