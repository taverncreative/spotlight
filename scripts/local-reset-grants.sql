-- Local tooling only. Restores the correct permission state after a local
-- `supabase db reset`. Run via `npm run db:reset`, never raw `supabase db
-- reset` (the npm script chains this file in for you).
--
-- Why this exists: on this machine's Supabase CLI the reset applies the
-- migrations before the default API-role grants are in place, so the reset
-- tables end up missing the standard SELECT/INSERT/UPDATE/DELETE grants for
-- anon, authenticated and service_role, which breaks the seed and every test
-- suite. Hosted Supabase manages these grants itself, so this is a local-stack
-- artifact, not a schema fault. That is why this stays OUT of the committed
-- migration chain (supabase/migrations): the grants are Supabase
-- infrastructure, not application schema.
--
-- It is idempotent and harmless if run against an already-correct database:
-- every statement is a grant/revoke that simply asserts the intended end
-- state.

-- 1. The standard Supabase grants across the public schema.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

-- 2. Re-apply the column-level update carve-outs, AFTER the blanket grant above
-- (which would otherwise re-grant full update on these two tables). The only
-- columns a normal authenticated session may update are users.full_name and
-- organisations.name / custom_field_definitions / brand_color / logo_url.
--
-- KEEP IN SYNC WITH migration 0003_rls_policies.sql (the users and organisations
-- name/custom_field_definitions carve-out), migration 0044_brand_color_grant.sql
-- (organisations.brand_color) and migration 0046_logo_url_grant.sql
-- (organisations.logo_url) - the branding settings write path: if those
-- carve-outs change, change these lines to match (each migration carries a
-- comment pointing back here, and CLAUDE.md records the dependency).
revoke update on public.users from authenticated;
grant update (full_name) on public.users to authenticated;

revoke update on public.organisations from authenticated;
grant update (name, custom_field_definitions, brand_color, logo_url)
  on public.organisations to authenticated;

-- 3. Re-apply the column-level SELECT carve-out on public.users from migration
-- 0025: co-member visibility exposes only id, full_name and email, never
-- platform_role or the timestamps. KEEP IN SYNC WITH migration
-- 0025_users_co_member_visibility.sql.
revoke select on public.users from authenticated;
grant select (id, full_name, email) on public.users to authenticated;

-- 4. Re-apply the execute carve-out on the automations engine function from
-- migration 0039: run_automation_create_task is SECURITY DEFINER and must stay
-- callable only by the service role (the engine), never a user session, even
-- after the blanket routine grant above re-granted it. KEEP IN SYNC WITH
-- migration 0039_run_automation_create_task.sql.
revoke execute on function public.run_automation_create_task(
  uuid, text, text, uuid, text, integer, uuid
) from anon, authenticated;
