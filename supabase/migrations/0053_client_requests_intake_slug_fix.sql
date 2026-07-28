-- CHERRY-PICKED ONTO MAIN 2026-07-28. The SQL below is unchanged; only this
-- note was added.
--
-- This migration was applied to PRODUCTION but its file lived only on the
-- unmerged branch feat/proposals-wip (022b10c), alongside 0051 and 0052. So
-- prod's ledger carried 0053 while main had no file for it, which meant
-- `db:reset` produced a local database still carrying the bug this fixes, and
-- anyone rebuilding prod from main would have silently lost the fix.
--
-- 0051 and 0052 are the proposals feature and are deliberately NOT brought
-- across: neither is applied to prod, and this file does not depend on them. It
-- touches only create_client_request, inbound_sources, clients and
-- client_requests, all of which exist on main.

-- Fix a 500 on the inbound path that only fires when a request carries a
-- client_slug. create_client_request returns table (id uuid, duplicate boolean),
-- so `id` is an OUT variable in scope for the whole body. 0045's slug lookup was
-- an unqualified `select id from public.clients`, which Postgres cannot resolve:
-- `id` could mean the OUT variable or clients.id, so it raises
-- "column reference \"id\" is ambiguous" and the route returns 500.
--
-- GEM never sends a client_slug (its requests are all unlinked), so the lookup
-- block was skipped and the bug stayed hidden. BSK sends client_slug, so every
-- BSK post hit it. The fix is to qualify the column via a table alias, exactly as
-- 0041 did before the 0045 rewrite dropped it.
--
-- CREATE OR REPLACE, byte-identical signature, so the route and ACL are
-- untouched; the anon-revoke / service_role grant is re-asserted at the end, as
-- 0045 does, because this is the security-critical inbound write path.
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
  -- The owner is whoever issued the source that authenticated this request,
  -- independent of how many operators exist (a second login can never break
  -- intake). Several live rows may share a source_app (rotation) but belong to
  -- one operator, so limit 1 is deterministic. A null here means the source was
  -- revoked between the token match and now: a hard error, not a silent misfile.
  select operator_id into v_operator_id
  from public.inbound_sources
  where source_app = p_source_app
    and revoked_at is null
  limit 1;
  if v_operator_id is null then
    raise exception 'no active inbound source for %', p_source_app;
  end if;

  -- Link to a client only when the slug names one THIS operator owns. The column
  -- is qualified through the alias c: an unqualified `id` collides with the OUT
  -- variable `id` and raises "column reference is ambiguous". Scoping to
  -- v_operator_id means a foreign or unknown slug simply leaves the request
  -- unlinked, keeping its free-text client_name.
  if p_client_slug is not null then
    select c.id into v_client_id
    from public.clients c
    where c.slug = p_client_slug
      and c.operator_id = v_operator_id
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
