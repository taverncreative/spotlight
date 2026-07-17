-- Close the inbound insert function to everyone except service_role.
--
-- THIS IS THE SECURITY FIX. Apply it before any endpoint calls the function.
--
-- create_client_request (0041) was created without grants, so it inherited
-- Supabase's default privileges: EXECUTE for anon, authenticated and
-- service_role. anon is the problem. NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ships
-- in the browser bundle, so it is public by definition, and PostgREST exposes
-- every public-schema function at /rest/v1/rpc/<name>. Anyone holding that key
-- could therefore POST straight to /rest/v1/rpc/create_client_request and insert
-- rows without ever touching the endpoint, which makes the endpoint's shared
-- secret decorative. This is not hypothetical: lib/content-api/auth.ts already
-- calls content_key_client by RPC with exactly that key, which is what proves
-- public-schema RPCs are anon-reachable here.
--
-- authenticated goes too. The operator's session must never insert an inbound
-- request: 0040 gives it no insert policy, and this function bypasses RLS, so
-- leaving EXECUTE would be a way around that.
--
-- Contrast 0035, where granting anon EXECUTE is correct and deliberate: reading
-- published posts is public anyway. An inbound write is not.
--
-- Idempotent, so it is safe on a fresh database (where 0041 has just created the
-- function with the same default grants) and on prod (where it has had them
-- since the function was applied by hand).
revoke all on function public.create_client_request(
  text, text, text, text, text, text, text, text
) from anon, authenticated, public;

grant execute on function public.create_client_request(
  text, text, text, text, text, text, text, text
) to service_role;
