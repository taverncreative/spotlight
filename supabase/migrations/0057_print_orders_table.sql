-- print_orders: inbound print jobs from other apps (GEM's print library first),
-- pooled into one fulfilment queue.
--
-- Mirrors client_requests (0039) deliberately, because it is the same shape of
-- problem: rows the operator did not create, arriving from outside over an
-- endpoint where there is no session. Same nullable client_id, same free-text
-- client_name fallback, same (source_app, order_id) idempotency, same
-- length-caps-at-the-table discipline. One way to hold inbound data, not two.
--
-- Unlike client_requests this is a header/items pair, because an order is a list
-- of things to print with quantities, and a JSON blob in a column would put the
-- item shape beyond the reach of both constraints and queries. The items live in
-- print_order_items (below) with a real foreign key.
--
-- client_id is nullable by design: an order may name a client we do not manage,
-- or name none at all, and client_name is what the queue reads either way.
-- on delete set null so removing a client never destroys the record of what was
-- printed for them.
create table public.print_orders (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  source_app text not null,
  -- The sender's own id for this order. Nullable (a sender need not have one),
  -- but when present it makes a retry idempotent via the partial unique index.
  order_id text,
  client_name text not null,
  submitter text,
  -- When the order was placed in the sending app, which is not when it reached
  -- us. Nullable: a sender need not know. created_at is our own receipt stamp,
  -- and the queue falls back to it for display.
  ordered_at timestamptz,
  status text not null default 'new'
    check (status in ('new', 'printing', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Length caps at the table, not just the route: the endpoint is public, so the
  -- last line of defence against an unbounded write belongs where nothing can
  -- forget it.
  constraint print_orders_client_name_len
    check (length(client_name) between 1 and 200),
  constraint print_orders_source_app_len
    check (length(source_app) between 1 and 64),
  constraint print_orders_submitter_len
    check (submitter is null or length(submitter) <= 200),
  constraint print_orders_order_id_len
    check (order_id is null or length(order_id) <= 128)
);

create index print_orders_operator_status_idx
  on public.print_orders (operator_id, status, created_at desc);
create index print_orders_client_id_idx on public.print_orders (client_id);

-- Idempotency. Partial so senders without an order_id are unconstrained, and
-- scoped by source_app so two senders cannot collide on the same id. This is
-- what makes GEM's fire-and-forget retry safe: a resend returns the original row
-- rather than printing the job twice.
create unique index print_orders_source_ref_idx
  on public.print_orders (source_app, order_id)
  where order_id is not null;

create trigger set_updated_at
  before update on public.print_orders
  for each row execute function public.set_updated_at();

-- The lines of an order. Cascade on delete: an item has no meaning without its
-- order, and nothing in the app deletes orders anyway (see 0058, which grants no
-- delete).
--
-- position preserves the sender's ordering, which a plain created_at cannot:
-- every item of an order is inserted in the same statement, so their timestamps
-- are identical and the sender's list order would otherwise be lost.
create table public.print_order_items (
  id uuid primary key default gen_random_uuid(),
  print_order_id uuid not null
    references public.print_orders (id) on delete cascade,
  position integer not null,
  name text not null,
  quantity integer not null,
  -- The sender's reference for this line (a document id, a file name). Free text
  -- to us: we only display it so John can find the thing to print.
  reference text,
  constraint print_order_items_name_len check (length(name) between 1 and 300),
  constraint print_order_items_reference_len
    check (reference is null or length(reference) <= 300),
  -- A quantity is a real print run, so bound it at the table. 10000 is far above
  -- anything John would run and far below anything that could be used to write a
  -- silly number into the queue.
  constraint print_order_items_quantity_range
    check (quantity between 1 and 10000),
  constraint print_order_items_position_positive check (position >= 0)
);

create index print_order_items_order_idx
  on public.print_order_items (print_order_id, position);
