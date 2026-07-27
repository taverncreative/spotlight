-- Per-client deploy hook: the build trigger for clients whose sites are static
-- (Astro) rather than Next.js with ISR. A static site bakes its posts at build
-- time from the content API (0035), so a new, edited or unpublished post is
-- invisible to visitors until the site rebuilds. This slice is storage only:
-- nothing fires yet.
--
-- deploy_hook_url holds AES-256-GCM CIPHERTEXT, never the URL itself. It is
-- written with encryptToken and read with decryptToken (lib/oauth/encryption.ts),
-- the same treatment as oauth_connections.access_token (0009) and for the same
-- reason: the URL IS the credential, so whoever holds it can queue unlimited
-- builds on the client's Vercel or Netlify account. text because the payload is
-- a base64 string (iv + auth tag + ciphertext). Hashing, as client_api_keys
-- (0033) does, is not an option here: the value has to stay replayable.
--
-- Null means no hook, either because the client's site is not static or because
-- one has not been pasted in yet. The length check only stops an empty string
-- standing in for null; the app already writes null for a blank field.
--
-- No paired policy: clients_operator_all (0003) is a table-wide `for all` on
-- operator_id, so it already covers these columns, the same as blog_base_url
-- (0038) and retainer_minutes (0054). No grant changes either, since these are
-- plain columns under the existing table-level grants, so
-- scripts/local-reset-grants.sql needs no matching edit. The operator's
-- `authenticated` role deliberately KEEPS select on the ciphertext column,
-- because the fire path (next slice) reads and decrypts it under the operator's
-- own session rather than a service-role key.
--
-- The ciphertext must never reach the browser or any public read path. Today it
-- cannot: 0032 revoked all anon table access, the content-API functions (0035)
-- hard-code their column allowlists, and app/home/page.tsx narrows the column to
-- a has_deploy_hook boolean before the row is handed to a client component. Any
-- new function or select over clients has to keep that true.
alter table public.clients
  add column deploy_hook_url text
    check (deploy_hook_url is null or length(deploy_hook_url) > 0);

-- The outcome of the last fire, written by the trigger path in the next slice
-- and overwritten each time. No history table on purpose: one operator and a
-- handful of static sites do not earn one, and the only question worth answering
-- is "is this hook still working".
--
-- text rather than int because a fire has three outcomes and only two of them
-- carry an HTTP status: '200' or '404' when a response came back, or 'timeout'
-- / 'error' when none did. Null means never fired.
--
-- Read it as "the build was QUEUED", never as "the post is live". A deploy hook
-- responds as soon as it accepts the job; whether the build then succeeded is
-- only knowable from the platform's own deployments API, which Spotlight does
-- not poll. Any UI over this column has to word it that way.
alter table public.clients
  add column deploy_hook_last_status text;

alter table public.clients
  add column deploy_hook_last_fired_at timestamptz;
