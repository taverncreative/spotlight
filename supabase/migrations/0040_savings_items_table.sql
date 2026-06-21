-- Savings items table (Phase 11, Pass 11A): a self-managed list where a
-- workspace records subscriptions it has cancelled, so the platform can total
-- the saving. The workspace enters and edits its own items; the platform only
-- stores, sums and displays. No derived total is stored: listSavings computes
-- the monthly and annual totals from the stored pence in the action.
--
-- It follows the tenant conventions of every feature table: organisation_id plus
-- the four audit columns and the shared updated_at trigger. Like tasks, notes,
-- contacts and templates it carries NO deleted_at: the workspace manages its own
-- list, so an item is removed by a permanent hard delete.
--
-- amount_pence is the cost saved, in integer pence per the money convention.
-- cadence records whether that cost recurred monthly or annually, so a mix can
-- be normalised to a single monthly and annual total; it defaults to monthly so
-- a workspace can enter either, and its CHECK is mirrored by SAVINGS_CADENCES in
-- lib/savings/schemas.ts (extend the two together). note and cancelled_on are
-- optional.

create table public.savings_items (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  label text not null,
  amount_pence integer not null,
  cadence text not null default 'monthly',
  note text,
  cancelled_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  constraint savings_items_cadence_check check (cadence in ('monthly', 'annual'))
);

create index savings_items_org_idx on public.savings_items (organisation_id);

create trigger set_updated_at
  before update on public.savings_items
  for each row execute function public.set_updated_at();
