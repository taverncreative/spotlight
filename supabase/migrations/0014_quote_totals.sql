-- Database-maintained quote totals. The money must always be correct
-- regardless of what changes a line, so the database maintains it: a BEFORE
-- trigger computes each line's net total, and an AFTER trigger recomputes
-- the parent quote whenever lines change. Application code never writes
-- these columns.
--
-- VAT is rounded per line (each line's net total times its rate, rounded to
-- the nearest penny, then summed), so mixed rates are handled correctly.
-- This is a deliberate, revisitable choice; see CLAUDE.md.

create function public.set_line_total()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.line_total_pence := round(new.quantity * new.unit_price_pence)::integer;
  return new;
end;
$$;

create trigger set_line_total
  before insert or update on public.quote_line_items
  for each row execute function public.set_line_total();

create function public.refresh_quote_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_quote uuid;
begin
  if tg_op = 'DELETE' then
    target_quote := old.quote_id;
  else
    target_quote := new.quote_id;
  end if;

  update public.quotes q
    set subtotal_pence = totals.subtotal,
        vat_pence = totals.vat,
        total_pence = totals.subtotal + totals.vat
    from (
      select
        coalesce(sum(line_total_pence), 0)::integer as subtotal,
        coalesce(sum(round(line_total_pence * vat_rate / 100)), 0)::integer as vat
      from public.quote_line_items
      where quote_id = target_quote
    ) totals
    where q.id = target_quote;

  -- An update may move a line to a different quote; refresh the old parent
  -- too so it never keeps stale totals.
  if tg_op = 'UPDATE' and old.quote_id is distinct from new.quote_id then
    update public.quotes q
      set subtotal_pence = totals.subtotal,
          vat_pence = totals.vat,
          total_pence = totals.subtotal + totals.vat
      from (
        select
          coalesce(sum(line_total_pence), 0)::integer as subtotal,
          coalesce(sum(round(line_total_pence * vat_rate / 100)), 0)::integer as vat
        from public.quote_line_items
        where quote_id = old.quote_id
      ) totals
      where q.id = old.quote_id;
  end if;

  return null;
end;
$$;

create trigger refresh_quote_totals
  after insert or update or delete on public.quote_line_items
  for each row execute function public.refresh_quote_totals();
