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

-- 1. The standard Supabase grants across the public schema, minus anon on
-- tables: migration 0032 revokes all anon table access (RLS already denies it
-- every row; TRUNCATE is not RLS-governed), so anon is deliberately absent
-- from the tables line. Sequence/routine grants stay as hosted Supabase has
-- them. KEEP IN SYNC WITH migration 0032_security_hardening.sql.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

-- 1b. Re-apply 0032's trim of authenticated, AFTER the blanket grant above
-- (which would otherwise re-grant them): TRUNCATE is RLS-exempt, REFERENCES
-- and TRIGGER are DDL-adjacent; PostgREST can express none of them.
revoke truncate, references, trigger on all tables in schema public
  from authenticated;

-- 2. Re-apply the column-level update carve-out on public.users, AFTER the
-- blanket grant above (which would otherwise re-grant full update). A session
-- may only ever update its own full_name; id and email are managed by auth.
-- KEEP IN SYNC WITH migration 0001_core_spine.sql (the users carve-out).
revoke update on public.users from authenticated;
grant update (full_name) on public.users to authenticated;

-- 3. Re-apply 0042's revoke on the inbound insert function, AFTER the blanket
-- routine grant above (which re-grants anon EXECUTE on every routine and would
-- otherwise silently reopen this on every reset).
--
-- Why this one function is different: 0035's content-API functions WANT anon
-- EXECUTE (reading published posts is public), which is why the blanket grant
-- suits them and 0035 says so. create_client_request is the opposite. The
-- publishable key is public, so anon EXECUTE lets anyone insert straight through
-- /rest/v1/rpc and skip the endpoint's shared secret. Without these two lines
-- local would be wide open while prod is closed, so the bypass would never show
-- up in local testing, which is the worst place for a security gap to hide.
-- KEEP IN SYNC WITH migration 0042_client_requests_intake_revoke.sql.
revoke all on function public.create_client_request(
  text, text, text, text, text, text, text, text
) from anon, authenticated;
grant execute on function public.create_client_request(
  text, text, text, text, text, text, text, text
) to service_role;
