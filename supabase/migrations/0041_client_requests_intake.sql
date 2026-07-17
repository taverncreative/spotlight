-- The inbound insert path. SECURITY DEFINER so it runs as its owner and can
-- write a table whose policies grant nobody insert. Everything it may do is
-- hard-coded here, so the route stays a thin validated pass-through.
--
-- Dedupe: (source_app, request_id) is uniquely indexed, so a retry carrying the
-- same request_id hits the conflict and gets the original row's id back. The
-- caller cannot tell a first send from a retry, and does not need to. Both are
-- success.
--
-- RECONCILIATION: already applied to prod by hand. Do NOT run against prod (the
-- function exists); record 0041 instead. Runs for real on a fresh database.
--
-- NOTE: this file deliberately carries NO grants, because that is the state prod
-- is actually in. Supabase's default privileges grant EXECUTE on new public
-- functions to anon, authenticated and service_role, so this function is
-- anon-callable as created. That is a live hole, and 0042 closes it. The chain
-- records what happened, then corrects it, rather than pretending the mistake
-- never existed.
create function public.create_client_request(
  p_source_app text,
  p_client_name text,
  p_message text,
  p_type text default 'other',
  p_client_slug text default null,
  p_submitter text default null,
  p_link text default null,
  p_request_id text default null
)
returns table (id uuid, duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
  v_operator_id uuid;
  v_id uuid;
  v_operators integer;
begin
  -- Resolve the client when the slug names one we manage. An unknown slug is not
  -- an error: the request stays unlinked and keeps its free-text client_name.
  if p_client_slug is not null then
    select c.id, c.operator_id into v_client_id, v_operator_id
    from public.clients c
    where c.slug = p_client_slug
    limit 1;
  end if;

  -- An unlinked request still needs an owner. Spotlight is single-operator by
  -- design, so fall back to the sole operator, and raise rather than guess if
  -- that ever stops being true. Loud beats silently misfiling someone's request.
  if v_operator_id is null then
    select count(*) into v_operators from auth.users;
    if v_operators <> 1 then
      raise exception 'inbound intake needs exactly one operator, found %',
        v_operators;
    end if;
    select u.id into v_operator_id from auth.users u;
  end if;

  insert into public.client_requests (
    operator_id, client_id, source_app, request_id,
    client_name, submitter, type, message, link
  ) values (
    v_operator_id, v_client_id, p_source_app, p_request_id,
    p_client_name, p_submitter, coalesce(p_type, 'other'), p_message, p_link
  )
  on conflict (source_app, request_id) where request_id is not null
  do nothing
  returning client_requests.id into v_id;

  if v_id is not null then
    return query select v_id, false;
    return;
  end if;

  -- Conflict: this request_id already landed. Hand back the original id so the
  -- retry reads as the success it is.
  select r.id into v_id
  from public.client_requests r
  where r.source_app = p_source_app and r.request_id = p_request_id;

  return query select v_id, true;
end;
$$;
