-- Stamp last_used_at when a content API key is actually used.
--
-- THE BUG THIS FIXES. client_api_keys.last_used_at exists and has never once
-- been written: all nine keys read "never used" while two client sites call the
-- endpoints daily. The column looks like a usage signal and is actually noise,
-- which is worse than not having it -- it is exactly the sort of field someone
-- trusts when deciding whether a key is safe to revoke.
--
-- The inbound endpoints already stamp theirs (lib/inbound/auth.ts). The content
-- API never did.
--
-- WHY A FUNCTION RATHER THAN AN UPDATE. The public routes deliberately use the
-- ANON client and never the operator or service-role one: the definer functions
-- are the only door, and 0032 denies anon every direct table grant. So anon
-- cannot write this column, and the fix is a narrow definer function rather than
-- widening what that client can touch.
--
-- Kept SEPARATE from content_key_client rather than folded into it. That
-- function is STABLE, and a stable function cannot write; making it volatile to
-- fit a side effect in would mean the read path silently became a write path,
-- which is a worse trade than one extra round trip.
--
-- The function takes the HASH, never the key, and returns nothing. It cannot be
-- used to discover whether a key exists: it updates zero rows for an unknown or
-- revoked hash and reports the same nothing either way.
create function public.touch_content_key(p_key_hash bytea)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.client_api_keys
  set last_used_at = now()
  where key_hash = p_key_hash
    and revoked_at is null;
$$;

-- Least privilege, stated rather than inherited. A fresh CREATE FUNCTION grants
-- EXECUTE to PUBLIC by Postgres default, so the revoke is what stops this being
-- open to anyone; the grants are then explicit rather than relying on Supabase's
-- default privileges, which is the mistake 0067 nearly repeated.
--
-- anon EXECUTE is required and safe: anon is the role the public routes run as,
-- and this function can only ever set a timestamp on a row whose hash the caller
-- already proved it holds.
revoke all on function public.touch_content_key(bytea) from public;

grant execute on function public.touch_content_key(bytea)
  to anon, authenticated, service_role;
