# BSK View

BSK View is the multi-tenant workspace platform Business Sorted Kent (BSK)
provides to its service-business clients. Each client gets a private workspace
with the modules their subscription enables (leads, customers, quotes, tasks,
notes, files, templates, automations and subscription savings), all behind
row-level tenancy.

The internal/repository name is `bsk-platform`. See `CLAUDE.md` for the full
context, architecture and working rules, and `docs/` for the architecture,
decision log and schema notes.

## Stack

Next.js + TypeScript (strict) + Tailwind + shadcn/ui (Base UI), Supabase
(Postgres, Auth, RLS, Storage), hosted on Vercel.

## Running it locally

1. Start the local Supabase stack:

   ```bash
   supabase start
   ```

2. Reset and seed the database (always use `db:reset`, never a raw
   `supabase db reset`, so the local-only grants are reapplied):

   ```bash
   npm run db:reset
   npm run seed:demo
   ```

3. Start the dev server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000/login](http://localhost:3000/login) and sign in
   with the demo account:

   - Email: `demo@kestrellifting.co.uk`
   - Password: `KestrelDemo2026!`

   You land on the workspace dashboard at `/app/kestrel-lifting`. Dark theme is
   the default; the toggle in the header switches to light. The accent colour is
   the workspace brand colour (`organisations.brand_color`).

## Tests

The Playwright suites run serially against the dev server. Run the whole suite
with `npm run test:routes`, or a single feature suite with one of the
`npm run test:*` scripts listed in `package.json`.
