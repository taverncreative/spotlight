-- Local tooling only. Restores the correct permission state after a local
-- `supabase db reset`. Run via `npm run db:reset`, never raw `supabase db
-- reset` (the npm script chains this file in for you).
--
-- Why this exists: on this machine's Supabase CLI the reset applies the
-- migrations before the default API-role grants are in place, so the reset
-- tables end up missing the standard SELECT/INSERT/UPDATE/DELETE grants for
-- anon, authenticated and service_role, which breaks the seed. Hosted Supabase
-- manages these grants itself, so this is a local-stack artifact, not a schema
-- fault. That is why this stays OUT of the committed migration chain
-- (supabase/migrations): the grants are Supabase infrastructure, not
-- application schema.
--
-- It is idempotent and harmless if run against an already-correct database:
-- every statement is a grant/revoke that simply asserts the intended end state.

-- 1. The standard Supabase grants across the public schema.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

-- 2. Re-apply the column-level update carve-out on public.users, AFTER the
-- blanket grant above (which would otherwise re-grant full update). A session
-- may only ever update its own full_name; id and email are managed by auth.
-- KEEP IN SYNC WITH migration 0001_core_spine.sql (the users carve-out).
revoke update on public.users from authenticated;
grant update (full_name) on public.users to authenticated;
