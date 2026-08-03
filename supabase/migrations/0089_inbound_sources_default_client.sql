-- A default client per inbound source, so a request that always belongs to the
-- same client arrives already assigned.
--
-- Every gem-crm request that has ever been assigned went to GEM Services -- all
-- seven of them -- and each was assigned by hand. The mapping already exists in
-- practice; this is where it gets written down.
--
-- OPT-IN, AND NULL MEANS "KEEP ASKING". A source with no default behaves exactly
-- as every source does today: the request arrives unassigned and waits for
-- triage. That matters because it is how a throwaway source stays deletable --
-- see the note on 0087 below.
--
-- ON DELETE SET NULL rather than cascade: deleting a client must not silently
-- take an inbound source's credential with it. The source keeps working and
-- reverts to asking, which is the safe direction to fail in.
alter table public.inbound_sources
  add column default_client_id uuid
    references public.clients (id) on delete set null;

create index inbound_sources_default_client_id_idx
  on public.inbound_sources (default_client_id);

-- The intake function learns one new step, and only one.
--
-- RESOLUTION ORDER, and the order is the contract:
--   1. p_client_slug, when it names a client this operator owns. An explicit
--      slug from the sender still wins, exactly as before.
--   2. otherwise the source's default_client_id.
--   3. otherwise null, and the request waits for triage.
--
-- THE WIRE CONTRACT IS UNCHANGED. No new parameter, no new response field,
-- nothing a sender must do differently. What changes is where a request lands,
-- which is our decision about our own data rather than anything BSK View or GEM
-- CRM can see or needs to handle.
--
-- The default is read from the SAME row that resolved the operator, so a
-- default can only ever point at a client that operator owns -- the clients
-- lookup is scoped to v_operator_id and the source belongs to them by
-- definition. A default cannot file a request under someone else's client.
--
-- ⚠️ INTERACTION WITH 0087, stated here because it is the surprising part.
-- 0087 permits deleting a request only where client_id is null. A source with a
-- default therefore produces requests that are undeletable from the moment they
-- arrive. That is correct for a real source -- a default means you have decided
-- those requests always belong to a client, and 0040's guarantee should apply --
-- but it means a throwaway or e2e source must NOT be given a default, or its
-- test rows become permanent. The alternative was widening the delete policy,
-- which was considered and rejected: it would give back exactly the protection
-- 0087 was careful to keep.
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
returns table(id uuid, duplicate boolean)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_client_id uuid;
  v_operator_id uuid;
  v_default_client_id uuid;
  v_id uuid;
begin
  -- The owner is whoever issued the source that authenticated this request,
  -- independent of how many operators exist (a second login can never break
  -- intake). Several live rows may share a source_app (rotation) but belong to
  -- one operator, so limit 1 is deterministic. A null here means the source was
  -- revoked between the token match and now: a hard error, not a silent misfile.
  --
  -- The default client is read in the SAME lookup. Where several live rows share
  -- a source_app, they are one sender rotating a secret, so any of them answers
  -- for the pair -- but a default set on one and not the other would make which
  -- row won matter. Ordering by default_client_id nulls last makes that
  -- deterministic: if any live row for this source names a default, it is used.
  select s.operator_id, s.default_client_id
    into v_operator_id, v_default_client_id
  from public.inbound_sources s
  where s.source_app = p_source_app
    and s.revoked_at is null
  order by s.default_client_id nulls last
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

  -- The source's default, only when the sender named no usable slug. Explicit
  -- beats remembered: a sender that knows which client this is for is telling us
  -- something the default cannot know.
  if v_client_id is null then
    v_client_id := v_default_client_id;
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
$function$;

-- NO GRANT CHANGE. 0042 granted EXECUTE on this function to service_role only,
-- and create or replace preserves that. Re-granting here would be a no-op at
-- best and, if the grant set ever changed, would quietly restore something that
-- was deliberately revoked.
--
-- NO POLICY CHANGE. inbound_sources is already operator-scoped, and
-- default_client_id is a column on a table that policy already covers.
