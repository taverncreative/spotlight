-- Pass 2A hardening: tenant-scoped foreign keys, the standing pattern for
-- every cross-table reference in Relay. A plain FK on customers(id) cannot
-- stop a lead in one organisation referencing a customer in another; making
-- both columns part of the key means the database itself enforces that the
-- referenced customer belongs to the same organisation as the lead. Quotes,
-- sites, contacts and the rest copy this when built.

-- Composite target for tenant-scoped references into customers.
alter table public.customers
  add constraint customers_organisation_id_id_key unique (organisation_id, id);

alter table public.leads
  drop constraint leads_converted_customer_id_fkey;

-- MATCH SIMPLE (the default) means the constraint is only checked when
-- converted_customer_id is set, so unconverted leads stay valid. ON DELETE
-- SET NULL names the nullable column only (Postgres 15+), so a customer
-- hard-delete clears the link and never touches the lead's NOT NULL
-- organisation_id.
alter table public.leads
  add constraint leads_converted_customer_id_fkey
  foreign key (organisation_id, converted_customer_id)
  references public.customers (organisation_id, id)
  on delete set null (converted_customer_id);
