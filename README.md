# Spotlight

Spotlight is the single-operator web agency console for Business Sorted Kent:
one operator signs in and manages client websites (uptime/SSL/domain
monitoring), blog posts, social publishing to Facebook and Instagram, and
GSC/GA4 analytics. Clients are first-class data, not users; a top client
selector scopes every module. See `CLAUDE.md` for working rules and `docs/`
for architecture and decisions.

## Stack

Next.js 16, TypeScript (strict), Tailwind 4 (config in CSS via `@theme`),
shadcn/ui on Base UI, Supabase (Postgres, Auth, RLS, Storage), Vercel.
Dark-first.

## Running it locally

1. Start the local Supabase stack (needs Docker):

   ```bash
   supabase start
   ```

2. Reset and seed the database (always `db:reset`, never a raw
   `supabase db reset`, so `scripts/local-reset-grants.sql` is reapplied):

   ```bash
   npm run db:reset
   npm run seed:demo
   ```

3. Start the dev server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000/login](http://localhost:3000/login) and sign in
   with the seeded operator:

   - Email: `demo@kestrellifting.co.uk`
   - Password: `KestrelDemo2026!`

   You land on the cross-client monitoring board at `/home`.

## Environment variables

Neither env file is committed. Values are never printed or logged.

**`.env.local`** — local development (read by the dev server and the
`--env-file` scripts):

| Variable                                                            | Purpose                                                     |
| ------------------------------------------------------------------- | ----------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Local Supabase stack                                        |
| `SUPABASE_SECRET_KEY`                                               | Service-role key (seed, sweep, crons)                       |
| `CRON_SECRET`                                                       | Bearer guarding the two cron endpoints                      |
| `SPOTLIGHT_TOKEN_KEY`                                               | AES-256-GCM key for stored OAuth tokens                     |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                         | Google OAuth (GSC/GA4 connects)                             |
| `META_APP_ID` / `META_APP_SECRET`                                   | Meta OAuth (Facebook/Instagram connects)                    |
| `APP_BASE_URL`                                                      | Public origin for OAuth redirects (the ngrok tunnel in dev) |

**`.env.vercel.local`** — production values staged locally, copied by hand
into the Vercel project's environment variables. Holds the production
Supabase URL/keys, `SPOTLIGHT_TOKEN_KEY`, `CRON_SECRET`, and `PROD_DB_URL`
(the 5432 session-pooler connection used for manual migrations and audits;
it is never read by the app). The Meta/Google OAuth vars and `APP_BASE_URL`
(the deployed origin) must also be set in Vercel for production connects —
they are not in this file.

## Crons

Defined in `vercel.json`, active from the next deploy after a push:

- `/api/cron/run-checks` — every 10 minutes; runs due site checks and writes
  `site_checks` rows.
- `/api/cron/run-publisher` — every 5 minutes; claims due scheduled social
  posts and publishes them.

Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically when the
`CRON_SECRET` env var is set on the project; both handlers reject anything
else with 401. Execution history: Vercel → Settings → Cron Jobs.

## Maintenance

- **Orphan storage sweep** — lists `social-media` objects with no
  `social_post_media` row:

  ```bash
  npm run sweep:social-orphans              # report only
  npm run sweep:social-orphans -- --delete  # delete orphans older than 24h
  ```

  Reads `.env.local`; run against production with
  `node --env-file=.env.vercel.local scripts/sweep-social-orphans.mts`.

- **Local reset** — `npm run db:reset` re-applies all migrations then
  `scripts/local-reset-grants.sql` (kept in sync with migration 0032's
  grant hardening), then `npm run seed:demo` restores the operator and
  sample clients.

- **Checks** — `npm run verify` runs typecheck, lint and the prettier check
  in one go. It is the pre-commit gate: run it before every commit and only
  commit on a clean pass.

## Fresh production deploy

1. **Supabase**: create/link the project, apply all migrations (via
   `supabase db push`, or `psql "$PROD_DB_URL" -1 -f <file>` per migration
   plus a matching row in `supabase_migrations.schema_migrations`). The chain
   includes 0032 (bucket upload limits, API-role grant hardening).
2. **Operator user**: create the operator login in Supabase Auth; the
   `handle_new_auth_user` trigger mirrors it into `public.users`.
3. **Vercel env**: copy the values from `.env.vercel.local`, then add
   `META_APP_ID`, `META_APP_SECRET`, `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, and `APP_BASE_URL` set to the deployed origin.
4. **OAuth consoles**: register the deployed redirect URIs —
   `<origin>/api/oauth/meta/callback` (Meta app) and
   `<origin>/api/oauth/google/callback` (Google Cloud OAuth client).
5. **Deploy**: push to `main`; Vercel builds and the crons activate.
6. **Verify**: sign in, run a manual site check, upload a composer photo,
   and confirm both cron endpoints return 200 in the logs on their next
   ticks (`{"checked":N}` / `{"claimed":N}`).
