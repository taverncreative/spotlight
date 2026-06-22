-- Map a site to one of the operator's Google Search Console properties (the
-- GSC siteUrl). Nullable: a site may be unmapped. The existing sites RLS
-- (owns_client via owns_site) already scopes reads and writes of this column,
-- so no new policy is needed.
alter table public.sites add column gsc_property text;
