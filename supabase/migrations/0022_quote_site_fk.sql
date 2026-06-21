-- Pass 5D: link a quote to the site where the work happens, completing the
-- last deferred foreign key (quotes.site_id, a plain uuid since migration
-- 0013). sites first becomes a tenant-scoped composite FK target, then
-- quotes.site_id is wired to it. The deferred-FK list is now empty.

-- Composite target for tenant-scoped references into sites (the same recipe as
-- customers and quotes).
alter table public.sites
  add constraint sites_organisation_id_id_key unique (organisation_id, id);

-- quotes.site_id becomes the tenant-scoped composite reference, so a quote can
-- only ever point at a site in its own organisation. MATCH SIMPLE (the
-- default) only checks the constraint when site_id is set, so quotes with no
-- site stay valid. ON DELETE SET NULL names the nullable column only (Postgres
-- 15+), so deleting a site clears the link and the quote survives, never
-- touching its NOT NULL organisation_id. The application also clears the link
-- when a quote's customer changes to one that does not own the site.
alter table public.quotes
  add constraint quotes_site_id_fkey
  foreign key (organisation_id, site_id)
  references public.sites (organisation_id, id)
  on delete set null (site_id);
