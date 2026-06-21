-- Open the admin write path for the workspace logo URL (Branding settings,
-- part 2), exactly as migration 0044 did for brand_color.
--
-- Extends the migration 0003 column-level update carve-out so a user session may
-- UPDATE organisations.logo_url (and only that, alongside name,
-- custom_field_definitions and brand_color). The row and role limits are
-- unchanged and already enforced by the organisations_update_admin_or_staff
-- policy (is_org_admin(id) or is_platform_staff()), so a non-admin cannot update,
-- no one can touch another org's row, and the column grant means an admin still
-- cannot set slug, entitlements or any other column. The actual bytes live in the
-- public 'logos' bucket (migration 0045); this column stores the resulting public
-- URL. It is a user-session, RLS-enforced write, not a new service-role surface.
--
-- KEEP IN SYNC WITH scripts/local-reset-grants.sql: that local-reset helper
-- re-applies the organisations column carve-out after its blanket grant, so its
-- grant statement now lists logo_url too. Proven by npm run test:admin-config-rls.

grant update (logo_url) on public.organisations to authenticated;
