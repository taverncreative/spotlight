-- Map a site to a Google Analytics 4 property (the GA4 property resource name,
-- e.g. "properties/123456789"). Nullable: a site may be unmapped. The existing
-- sites RLS (owns_client via owns_site) already scopes this column, so no new
-- policy is needed. Twin of gsc_property (0017).
alter table public.sites add column ga4_property text;
