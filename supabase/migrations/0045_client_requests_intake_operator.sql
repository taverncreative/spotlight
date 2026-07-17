-- Fix the 500 on the inbound path: create_client_request raised
-- "inbound intake needs exactly one operator, found N" whenever it could not
-- resolve an operator from a client slug and auth.users held anything other than
-- one row. Prod grew a second login (studio@ alongside jl@, same org), so every
-- inbound POST that carried no client_slug -- which is every GEM post -- hit that
-- raise and returned 500. The single-operator assumption was a landmine, and a
-- second login stepped on it.
--
-- The real owner of an inbound request is the operator who ISSUED the source that
-- authenticated it, and inbound_sources.operator_id already records that. Resolve
-- from there instead of counting auth.users, so the number of operators is
-- irrelevant and a second login can never break intake again.
--
-- Signature is byte-identical to 0041, so this is a pure CREATE OR REPLACE:
-- the route is untouched, and the ACL (service_role only, anon revoked) is
-- preserved by REPLACE. The grant is re-asserted at the end anyway, because this
-- is the security-critical inbound function and the anon-revoke must never be in
-- doubt.
create or replace function public.create_client_request(
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
begin
  -- The owner is whoever issued the source that authenticated this request.
  -- Independent of how many operators exist. Several live rows may share a
  -- source_app (rotation), but they belong to one operator, so limit 1 is
  -- deterministic. The route only reaches this after matching the token to a live
  -- source, so a null here means that source was revoked between the match and
  -- now -- treat it as a hard error rather than silently misfiling.
  select operator_id into v_operator_id
  from public.inbound_sources
  where source_app = p_source_app
    and revoked_at is null
  limit 1;
  if v_operator_id is null then
    raise exception 'no active inbound source for %', p_source_app;
  end if;

  -- Link to a client only when the slug names one THIS operator owns. Scoping the
  -- lookup to v_operator_id means a sender cannot link its request to another
  -- operator's client by guessing a slug -- an unknown or foreign slug simply
  -- leaves the request unlinked, keeping its free-text client_name.
  if p_client_slug is not null then
    select id into v_client_id
    from public.clients
    where slug = p_client_slug
      and operator_id = v_operator_id
    limit 1;
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

-- Re-assert least privilege. REPLACE preserves the existing ACL, but this is the
-- inbound write path, so the anon-revoke is stated explicitly rather than assumed.
-- KEEP IN SYNC WITH scripts/local-reset-grants.sql (the same carve-out).
revoke all on function public.create_client_request(
  text, text, text, text, text, text, text, text
) from anon, authenticated, public;
grant execute on function public.create_client_request(
  text, text, text, text, text, text, text, text
) to service_role;
