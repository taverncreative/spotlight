@AGENTS.md

# CLAUDE.md - Spotlight

Standing rules for this repo. Read before any task. Prompts give only the task; the recurring rules live here.

## Project
Spotlight is a single-operator web agency console for John (Business Sorted Kent) to manage client websites and Google profiles. One operator logs in; clients are first-class data, not users. One client is in focus at a time, set by a top client selector that scopes every module, with modules along a bottom tab bar.

## Stack and environment
- Next.js 16, TypeScript strict, Tailwind 4 (config in CSS via @theme, there is no tailwind.config), shadcn/ui on Base UI, Supabase (Postgres, auth, storage), Vercel. Dark-first.
- Next.js 16 diverges from training data. Read node_modules/next/dist/docs/ rather than relying on memory. Middleware is proxy.ts (renamed from middleware.ts). Reconcile these notes with AGENTS.md if it exists.

## Git and commit discipline
- Trunk-based on main. John pushes, not CC.
- Commit protocol: stay on main, stage explicitly (never a blind add -A), one commit, use the commit message body verbatim as given, then report the hash and staged file status. Do not push; wait for John's separate push order.
- Clean tree between slices. One slice at a time.

## Verify before commit (hard gate)
- John confirms behaviour in the browser before any commit. A build, tsc or test pass is not verification on its own. A pure-backend change proven by a real round-trip test counts.

## Database and migrations
- Schema changes are Supabase migrations only. Never hand-edit generated files.
- Convention: sequential NNNN_description.sql, paired table-then-policy (NNNN_x_table then NNNN_x_policies).
- RLS scopes every table to the operator: operator_id = auth.uid(), directly or via a client_id join. This is the data-isolation seam; treat it as load-bearing.
- Local: db:reset re-applies scripts/local-reset-grants.sql; keep that grants script in sync with column grants.

## Build practice
- Read-only recon before any non-trivial build. HTML mockups before UI builds (John is a visual learner).
- Proceed on your recommended next steps without pausing; reserve questions for genuine forks with material trade-offs. Honest pushback and risk-flagging always welcome.

## Risk routing (match autonomy to stakes)
- Low-stakes, proceed autonomously and work straight through a batch: cosmetic UI and theming, copy and microcopy, isolated presentational components, HTML mockups, read-only recon, read-only display of already-stored data, and CRUD on the operator's own client and site records.
- High-stakes, plan then get John's review then build then John pushes, and do NOT autonomously commit: authentication and the OAuth/token layer, anything storing or using client access tokens, database schema, migrations and RLS, the scheduled workers that take unattended outward actions, anything that writes to a client's live external properties (social publishing, GMB edits, blog publishing), secrets and .env, and production cutover. There is no payments surface in this project.

## Style
UK English. No em dashes. Concise and decisive. Lead every report with a one-sentence pass/fail.
