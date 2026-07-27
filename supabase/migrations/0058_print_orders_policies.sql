-- RLS for the print orders queue: the operator reads and updates their own
-- inbound orders. Nothing else touches these tables.
--
-- Mirrors client_requests' policies (0040) exactly, including what is DENIED:
--
--   * No insert policy. Rows arrive only through create_print_order (0059),
--     which is SECURITY DEFINER and so runs as its owner, outside these
--     policies. Denying insert to authenticated means even a stolen operator JWT
--     cannot forge a print order directly.
--   * No delete policy. An order can be moved to 'done' but never removed, so
--     the record of what was asked for is not destructible from the app.
--
-- No anon or public policy is needed, because anon has no grants on these
-- tables: 0032 revoked all anon table access and set default privileges so new
-- tables inherit none. The publishable key can do nothing here even if the
-- inbound endpoint were wide open.
alter table public.print_orders enable row level security;

create policy print_orders_operator_select on public.print_orders
  for select to authenticated
  using (operator_id = (select auth.uid()));

create policy print_orders_operator_update on public.print_orders
  for update to authenticated
  using (operator_id = (select auth.uid()))
  with check (operator_id = (select auth.uid()));

-- Items carry no operator_id of their own: they are scoped through their parent
-- order, which is the same client_id-join seam every other child table here
-- uses. Storing a second copy of operator_id on the item would be a second
-- source of truth that could drift from the header.
--
-- Select only. Items are written once by the intake function and never edited:
-- the operator triages an order's STATUS, they do not rewrite what the client
-- asked to be printed.
alter table public.print_order_items enable row level security;

create policy print_order_items_operator_select on public.print_order_items
  for select to authenticated
  using (
    exists (
      select 1
      from public.print_orders o
      where o.id = print_order_items.print_order_id
        and o.operator_id = (select auth.uid())
    )
  );
