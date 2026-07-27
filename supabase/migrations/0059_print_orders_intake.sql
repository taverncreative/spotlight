-- The inbound insert path for print orders. SECURITY DEFINER so it runs as its
-- owner and can write tables whose policies grant nobody insert. Everything it
-- may do is hard-coded here, so the route stays a thin validated pass-through.
--
-- Header and items in ONE function, therefore one transaction. This is the whole
-- reason intake is a function rather than two calls from the route: an order
-- whose header landed but whose items did not would show in the queue as a job
-- with nothing to print, and the operator would have no way to tell it from a
-- genuinely empty order. Either the whole order lands or none of it does.
--
-- Dedupe: (source_app, order_id) is uniquely indexed, so a retry carrying the
-- same order_id hits the conflict and gets the original row's id back WITHOUT
-- re-inserting its items. The caller cannot tell a first send from a retry, and
-- does not need to. Both are success. This matters more here than it does for
-- feedback: GEM posts fire-and-forget with retries, and a duplicate print order
-- is a duplicate physical print run.
--
-- Operator resolution follows 0045, not 0041: the owner is whoever ISSUED the
-- source that authenticated this order, read from inbound_sources. 0041's
-- original approach (count auth.users, raise unless exactly one) was a landmine
-- that went off in prod the moment a second login existed. It is not repeated
-- here.
create function public.create_print_order(
  p_source_app text,
  p_client_name text,
  p_items jsonb,
  p_client_slug text default null,
  p_submitter text default null,
  p_ordered_at timestamptz default null,
  p_order_id text default null
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
  -- Items are validated at the route by zod, but this function is the last thing
  -- standing before the write and it must not be reachable into a bad state by
  -- any other caller. An order with no lines is not an order.
  if p_items is null
     or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) = 0 then
    raise exception 'print order needs at least one item';
  end if;

  -- The owner is whoever issued the source that authenticated this order.
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
  -- lookup to v_operator_id means a sender cannot link its order to another
  -- operator's client by guessing a slug -- an unknown or foreign slug simply
  -- leaves the order unlinked, keeping its free-text client_name.
  if p_client_slug is not null then
    select c.id into v_client_id
    from public.clients c
    where c.slug = p_client_slug
      and c.operator_id = v_operator_id
    limit 1;
  end if;

  insert into public.print_orders (
    operator_id, client_id, source_app, order_id,
    client_name, submitter, ordered_at
  ) values (
    v_operator_id, v_client_id, p_source_app, p_order_id,
    p_client_name, p_submitter, p_ordered_at
  )
  on conflict (source_app, order_id) where order_id is not null
  do nothing
  returning print_orders.id into v_id;

  -- Conflict: this order_id already landed. Hand back the original id so the
  -- retry reads as the success it is, and do NOT touch its items.
  if v_id is null then
    select o.id into v_id
    from public.print_orders o
    where o.source_app = p_source_app and o.order_id = p_order_id;

    return query select v_id, true;
    return;
  end if;

  -- WITH ORDINALITY preserves the sender's list order. Every item lands in this
  -- one statement, so timestamps could not distinguish them.
  insert into public.print_order_items (
    print_order_id, position, name, quantity, reference
  )
  select
    v_id,
    (t.ord - 1)::integer,
    t.item ->> 'name',
    (t.item ->> 'quantity')::integer,
    -- NULLIF unqualified on purpose: it is a SQL construct, not a schema
    -- function, so it resolves fine under search_path = '' and CANNOT be
    -- pg_catalog-qualified. An absent reference and an empty one are the same
    -- thing to us, and the column is nullable.
    nullif(t.item ->> 'reference', '')
  from pg_catalog.jsonb_array_elements(p_items)
    with ordinality as t(item, ord);

  return query select v_id, false;
end;
$$;

-- Least privilege, stated explicitly rather than inherited. Supabase's default
-- privileges grant EXECUTE on new public functions to anon, authenticated and
-- service_role, and anon is the problem: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
-- ships in the browser bundle, and PostgREST exposes every public-schema
-- function at /rest/v1/rpc/<name>, so an anon grant would let anyone insert
-- print orders without ever touching this endpoint and make the shared secret
-- decorative. That hole is what 0042 had to close after the fact for
-- create_client_request; this function is born closed instead.
--
-- authenticated goes too: 0058 gives the operator's session no insert policy,
-- and this function bypasses RLS, so leaving EXECUTE would be a way around that.
--
-- KEEP IN SYNC WITH scripts/local-reset-grants.sql (the same carve-out).
revoke all on function public.create_print_order(
  text, text, jsonb, text, text, timestamptz, text
) from anon, authenticated, public;

grant execute on function public.create_print_order(
  text, text, jsonb, text, text, timestamptz, text
) to service_role;
