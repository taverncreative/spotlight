# Architecture

Status: draft for human review (Phase 0, Pass 0A). Each section gives a
single recommendation, not a survey of options. Nothing here is provisioned
yet; this document is the plan.

## 1. Tenancy enforcement

Recommendation: RLS as the primary enforcement, with explicit organisation
scoping in every query as well.

How it works in practice:

- Server actions and route handlers use a Supabase client carrying the
  signed-in user's session, so every query passes through Row Level Security.
  Policies only return rows belonging to organisations the user is a member
  of.
- Application code still writes `organisation_id = ...` filters explicitly.
  This is not the security boundary, it is documentation and a performance
  hint, and it means a policy bug and a code bug must both happen before data
  leaks.
- The service-role key (which bypasses RLS) is used only where there is no
  user session: the public lead webhook, background automation runs, and the
  BSK admin area. Every service-role query must scope by organisation
  explicitly, and these call sites are kept few and easy to audit.

Why this way round, in plain English: with the service-role key as the
default, every single query is one forgotten `where` clause away from showing
one client another client's data. With RLS as the default, a forgotten filter
returns the wrong rows from the right organisation at worst, and usually just
returns nothing. For a platform holding many small businesses' customer data,
the database refusing to hand over the wrong tenant's rows is worth the extra
care policies need. The known costs are accepted: policies need testing like
code, and policy predicates must be written so Postgres can use indexes (for
example wrapping `auth.uid()` in a sub-select).

## 2. Auth model

Recommendation: Supabase Auth with email and password, cookie-based sessions
via the official `@supabase/ssr` helpers, and an invitation-only sign-up flow.

- No public sign-up. Every account starts as an invitation, because every
  tenant is an existing BSK client.
- Sessions live in HTTP-only cookies managed by `@supabase/ssr`. Next.js
  middleware refreshes the session token on each request; server actions and
  server components read the session server-side. No tokens in localStorage.
- Invitation flow: a client_admin (or BSK) enters an email address and role.
  The server creates an `organisation_memberships` row in `invited` state and
  sends a Supabase invitation email. The invitee follows the link, sets a
  password, and the membership flips to `active` on first sign-in. Invites
  expire and can be re-sent.
- Auth emails use Supabase's built-in sender to start with. Per-client Resend
  domains are for product email (lead notifications and similar), not auth
  email, and arrive in a later pass.

## 3. Roles

Two levels, because BSK staff and client users are different things:

- Platform roles, held on the `users` table: `super_admin` (BSK, full
  control including entitlements and billing) and `bsk_support` (read access
  to client workspaces for support; every access is written to the audit
  log). Most users have no platform role.
- Organisation roles, held per membership on `organisation_memberships`:
  `client_admin` (manages users, settings and webhook forms), `manager`
  (full day-to-day data access), `staff` (works records but cannot manage
  users or settings), `read_only` (views only).

Role checks happen server-side on every action, always. Hiding a button in
the UI is a courtesy, never the control.

## 4. Modules and entitlements

Recommendation: entitlements are the single source of truth for what an
organisation can use; plans are just bundles that generate entitlements.

- `plans`: the bundles BSK sells (for example Core, Growth).
- `plan_modules`: which modules each plan includes.
- `organisation_entitlements`: one row per organisation per module, with a
  seat band and a `source` of either `plan` or `add_on`. Assigning a plan to
  an organisation materialises one entitlement row per plan module with
  `source = 'plan'`. Buying an extra module adds a row with
  `source = 'add_on'`. Changing plan re-materialises the `plan` rows and
  leaves `add_on` rows alone.
- The UI never asks "what plan is this organisation on" to decide what to
  show. Module visibility, navigation and route access are all consequences
  of entitlement rows, checked server-side.

Billing is manual at first: BSK invoices the client and sets the plan and
add-ons in the admin area. The model maps onto Stripe later as one
subscription per organisation with multiple line items: the plan is one line
item and each add-on is another, which is exactly one entitlement source
each. When Stripe arrives, a webhook updates entitlements; nothing about how
the rest of the platform checks access changes.

## 5. Routing

Recommendation: organisation slug in the path, `/app/[orgSlug]/...`.

Reasons: every URL says which workspace it belongs to, so links are
shareable and bookmarkable; support can reproduce exactly what a client
reports by following the same URL; two browser tabs in two organisations
cannot contaminate each other, which session-based "active organisation"
state gets wrong; and the server resolves the organisation from route params
on every request with no hidden state. Most client users belong to exactly
one organisation, so after sign-in they are redirected straight to their
slug and never think about it. BSK staff, who do switch organisations, get
the most benefit from explicit URLs.

## 6. API conventions

Every server action and route handler runs the same pipeline, in this order,
with a shared helper covering steps 1 to 4 so it cannot be half-applied:

1. Validate auth: a signed-in user exists, otherwise reject.
2. Resolve the organisation from the route's `orgSlug`.
3. Check membership: the user has an active membership in that organisation
   (or a platform role that permits access, which is audit-logged).
4. Check permission: the membership role allows this specific action.
5. Validate input with Zod. Nothing reaches a query unparsed.
6. Scope the query: explicit `organisation_id` filter, with RLS underneath
   as the enforcement layer.
7. Log sensitive actions (user management, entitlement changes, exports,
   deletions, BSK support access) to the audit log.

## 7. Environments

Three environments, secrets via environment variables only:

- Local: Next.js dev server against the Supabase CLI local stack (Docker).
  Secrets in `.env.local`, which is gitignored.
- Staging: a dedicated staging Supabase project, used by Vercel preview
  deployments. Realistic but disposable data.
- Production: a separate production Supabase project, used only by the
  Vercel production deployment.

Staging and production secrets live in Vercel environment settings, scoped
per environment. The service-role key is server-only and is never exposed
under a `NEXT_PUBLIC_` name. No secrets in the repository, ever.

## 8. Public lead webhook

Websites BSK builds for clients post form submissions to the platform.

- Endpoint: `POST /api/lead-webhooks/[token]`. The token is a long random
  per-form secret from `webhook_forms` (at least 32 random bytes, URL-safe).
  The raw organisation id never appears in a URL. Tokens can be regenerated,
  which immediately invalidates the old one, and forms can be disabled.
- The handler runs server-side with the service role: look up the active
  form by token (unknown or disabled token gets a generic 404), apply rate
  limits, then insert a lead scoped to the form's organisation.
- Rate limiting: a simple fixed-window limit per token and per source IP,
  enforced in Postgres to avoid new infrastructure. Over-limit requests get 429.
- Spam handling, basic by design: a honeypot field (filled means the lead is
  stored flagged as spam, response still looks successful), a payload size
  cap, and Zod validation of the expected fields. Suspicious submissions are
  flagged rather than dropped, so a client can rescue a false positive.
- The full submitted payload is kept on the lead, so nothing a client's form
  sends is lost even if it does not map to a core column.
