# Schema draft

Status: documentation only (Phase 0, Pass 0A). No migration files exist and
nothing is provisioned. This is the draft for human review before any SQL is
written.

## Conventions

- Primary keys: `id uuid` default `gen_random_uuid()`.
- Every tenant table carries: `organisation_id` (FK to organisations, not
  null), `created_at`, `updated_at` (timestamptz, default `now()`),
  `created_by`, `updated_by` (FK to users). Insert-only log tables carry the
  same columns for consistency but are never updated, enforced by policy.
- Every tenant table has an index starting with `organisation_id`; most are
  composite with the column queried most often. All foreign keys are
  indexed.
- Money is stored in pence as integers. Dates that are "a day" are `date`;
  moments are `timestamptz`.
- Soft state lives in `status` text columns with CHECK constraints, not
  enums, so adding a state does not need a migration of a type.
- Derived facts are never stored. Task "overdue" is `due_at < now()` while
  the task is not done or cancelled. It is computed in queries, never a
  status value.
- `custom_fields jsonb` on leads, customers, sites and quotes holds
  industry-specific values. The field definitions live per organisation (see
  organisations.custom_field_definitions), so specialist fields (for example
  LOLER certificate numbers for the lifting pilot) never become core
  columns.
- Soft delete: leads, customers, sites and quotes carry a nullable
  `deleted_at timestamptz` when those tables are built. Normal deletion sets
  it; queries exclude rows where it is set. A separate, deliberate hard-erase
  path exists for GDPR erasure requests and really deletes. Organisations use
  their `status` column (active, suspended, archived) as their soft-delete
  equivalent, and memberships use theirs (invited, active, disabled), so
  neither gets `deleted_at`.

## RLS policy classes

Each table is assigned one class. Policies are written per class so they
stay consistent.

- Class A, tenant read and write: active members of the organisation can
  read; write permission depends on role (read_only never writes; other
  role rules are enforced in server actions and mirrored in policies where
  practical).
- Class B, tenant admin write: members can read, only client_admin (and
  platform staff) can write. For settings-like tables.
- Class C, platform managed: members can read rows for their organisation
  (or the table is global and all authenticated users can read), but only
  the service role / platform staff can write. Clients can never change
  these.
- Class D, insert-only log: rows are inserted by the system (service role
  or trigger), members can read their organisation's rows, nobody updates
  or deletes.
- Class E, platform only: no client access at all. Read and write only via
  service role, surfaced in the BSK admin area.

## Platform tables (no organisation_id)

### users

Mirror of auth.users, one row per person, created by trigger on sign-up.

- id uuid PK, equals auth.users.id
- email text not null
- full_name text
- platform_role text null, CHECK in ('super_admin', 'bsk_support')
- created_at, updated_at
- RLS: users read and update their own row; platform staff read all.
  (Self plus platform; closest to Class C for writes by others.)

### plans

The bundles BSK sells.

- id uuid PK
- key text unique (for example 'core', 'growth')
- name text, description text
- monthly_price_pence integer not null
- is_active boolean default true
- created_at, updated_at
- RLS: Class C (global read for authenticated users, platform writes).

### plan_modules

Which modules a plan includes. Module keys are a fixed list ('leads',
'customers', 'quotes', 'tasks', 'files', 'templates', 'automations',
'subscription_savings'), defined once as the `module_key` Postgres domain so
every module column shares one CHECK and the list cannot drift between
tables.

- id uuid PK
- plan_id uuid FK plans, not null
- module text not null, CHECK against the module key list
- unique (plan_id, module)
- created_at, updated_at
- RLS: Class C.

## Tenant core tables

### organisations

One row per client workspace. Not itself a tenant table (it is the tenant),
but carries the same audit columns.

- id uuid PK
- name text not null
- slug text unique not null (used in /app/[orgSlug] routing)
- status text CHECK in ('active', 'suspended', 'archived') default 'active'
- plan_id uuid FK plans null (the currently assigned plan; entitlements
  remain the source of truth for access)
- custom_field_definitions jsonb default '{}' (per-entity field
  definitions, for example {"leads": [{"key": "swl", "label": "Safe working
  load", "type": "number", "required": false}]})
- next_quote_number integer default 1 (per-organisation quote numbering)
- created_at, updated_at, created_by, updated_by
- Indexes: unique (slug)
- RLS: members read their own organisation; client_admin updates limited
  fields (name, custom_field_definitions); platform writes everything else.
  Class B with a platform-only column carve-out.

### organisation_memberships

Who belongs to which workspace, with what role.

- id uuid PK
- organisation_id uuid FK, user_id uuid FK users, both not null
- role text not null CHECK in ('client_admin', 'manager', 'staff',
  'read_only')
- status text CHECK in ('invited', 'active', 'disabled') default 'invited'
- invited_by uuid FK users null
- created_at, updated_at, created_by, updated_by
- unique (organisation_id, user_id)
- Indexes: (user_id) for "my organisations" lookup
- RLS: Class B (members read the member list; client_admin and platform
  manage it). This table is also what most other policies join through, so
  its own policies must not recurse (use a security definer helper
  function).

### organisation_entitlements

Single source of truth for module access. See architecture section 4.

- id uuid PK
- organisation_id uuid FK not null
- module text not null, CHECK against the module key list
- source text not null CHECK in ('plan', 'add_on')
- seat_band text null (for example '1-5', '6-15'; null means unlimited)
- created_at, updated_at, created_by, updated_by
- unique (organisation_id, module)
- RLS: Class C (members read their organisation's entitlements, only
  platform writes).

## Tenant data tables

All tables below: tenant table conventions apply (organisation_id plus the
four audit columns), and RLS Class A unless stated otherwise.

### leads

Inbound enquiries, mostly from webhook forms.

- id uuid PK
- webhook_form_id uuid FK webhook_forms null (null when entered manually)
- name text, email text, phone text, message text
- source text (for example 'website', 'phone', 'referral')
- status text CHECK in ('new', 'contacted', 'qualified', 'converted',
  'rejected', 'spam') default 'new'
- converted_customer_id uuid FK customers null
- custom_fields jsonb default '{}'
- raw_payload jsonb null (the full webhook submission, kept verbatim)
- deleted_at timestamptz null (soft delete, per the conventions above)
- Indexes: (organisation_id, status), (organisation_id, created_at desc),
  both partial WHERE deleted_at IS NULL since normal reads only want
  active rows

### customers

The client's customers.

- id uuid PK
- name text not null
- type text CHECK in ('business', 'individual') default 'business'
- email text, phone text
- address_line1, address_line2, town, county, postcode (text)
- custom_fields jsonb default '{}'
- deleted_at timestamptz null (soft delete, per the conventions above)
- Indexes: (organisation_id, name), partial WHERE deleted_at IS NULL

### contacts

People at a customer.

- id uuid PK
- customer_id uuid FK customers not null
- name text not null, email text, phone text, job_title text
- is_primary boolean default false
- Indexes: (customer_id)

### sites

Locations where work happens (a customer can have many).

- id uuid PK
- customer_id uuid FK customers not null
- name text not null
- address_line1, address_line2, town, county, postcode (text)
- access_notes text
- custom_fields jsonb default '{}'
- Indexes: (customer_id)

### quotes

- id uuid PK
- customer_id uuid FK customers not null
- site_id uuid FK sites null
- quote_number integer not null (from organisations.next_quote_number)
- title text
- status text CHECK in ('draft', 'sent', 'accepted', 'declined', 'expired')
  default 'draft'
- issued_at timestamptz null, valid_until date null
- subtotal_pence, vat_pence, total_pence integers, maintained by database
  triggers whenever line items change (VAT rounded per line, then summed)
- custom_fields jsonb default '{}'
- deleted_at timestamptz null (soft delete; line items hard-delete, the
  quote carries the recoverable delete)
- unique (organisation_id, quote_number); unique (organisation_id, id) as
  the composite FK target for line items
- customer_id via tenant-scoped composite FK, ON DELETE RESTRICT
- Indexes: (organisation_id, status) partial WHERE deleted_at IS NULL,
  (organisation_id, customer_id)

### quote_line_items

- id uuid PK
- quote_id uuid FK quotes not null
- position integer not null
- description text not null
- quantity numeric(10,2) not null default 1
- unit_price_pence integer not null
- vat_rate numeric(5,2) not null default 20.00
- line_total_pence integer not null
- Indexes: (quote_id)

### tasks

- id uuid PK
- title text not null, description text
- status text CHECK in ('open', 'in_progress', 'done', 'cancelled')
  default 'open'. There is deliberately no 'overdue' status: overdue is
  derived from due_at in queries.
- due_at timestamptz null
- assigned_to uuid FK users null
- related_type text null CHECK in ('lead', 'customer', 'site', 'quote'),
  related_id uuid null (loose link, no FK; the pair is set or null
  together)
- Indexes: (organisation_id, status, due_at), (assigned_to)

### notes

Free-text notes attached to records.

- id uuid PK
- body text not null
- related_type text not null CHECK in ('lead', 'customer', 'site', 'quote',
  'task'), related_id uuid not null
- Indexes: (organisation_id, related_type, related_id)

### files

Metadata for Supabase Storage objects. Storage bucket paths start with the
organisation id and storage policies mirror table RLS.

- id uuid PK
- storage_path text not null unique
- file_name text not null, mime_type text, size_bytes bigint
- related_type text null CHECK in ('lead', 'customer', 'site', 'quote',
  'task'), related_id uuid null
- Indexes: (organisation_id, related_type, related_id)

### templates

Reusable content (email bodies, quote boilerplate).

- id uuid PK
- type text not null CHECK in ('email', 'quote', 'document')
- name text not null
- content text not null
- is_active boolean default true
- Indexes: (organisation_id, type)

### automation_rules

- id uuid PK
- name text not null
- trigger text not null (code-defined key, for example 'lead.created')
- conditions jsonb default '[]'
- actions jsonb default '[]'
- is_enabled boolean default false
- RLS: Class B (members read, client_admin writes)
- Indexes: (organisation_id, trigger) partial where is_enabled

### automation_runs

One row per rule execution. Insert-only.

- id uuid PK
- rule_id uuid FK automation_rules not null
- triggered_by_type text, triggered_by_id uuid (what fired it)
- status text CHECK in ('success', 'failed', 'skipped')
- started_at, finished_at timestamptz
- error text null
- payload jsonb null
- RLS: Class D
- Indexes: (organisation_id, created_at desc), (rule_id)

### activity_log

Client-visible timeline ("Jo converted lead X"). Insert-only.

- id uuid PK
- actor_user_id uuid FK users null (null for system actions)
- verb text not null (for example 'created', 'updated', 'converted')
- related_type text, related_id uuid
- summary text not null (human-readable line)
- metadata jsonb default '{}'
- RLS: Class D
- Indexes: (organisation_id, created_at desc), (organisation_id,
  related_type, related_id)

### audit_log

Security and compliance record, never shown to clients. Insert-only.

- id uuid PK
- organisation_id uuid FK null (null for platform-wide actions)
- actor_user_id uuid FK users null
- action text not null (for example 'entitlement.updated',
  'support.accessed_workspace', 'membership.role_changed')
- target_type text, target_id uuid
- metadata jsonb default '{}' (including before and after values where
  relevant)
- created_at, created_by (no updates, ever)
- RLS: Class E (platform only)
- Indexes: (organisation_id, created_at desc), (action)

### webhook_forms

One row per public lead form. See architecture section 8.

- id uuid PK
- name text not null (for example 'Contact page form')
- token text unique not null (at least 32 random bytes, URL-safe; the only
  credential in the public URL)
- status text CHECK in ('active', 'disabled') default 'active'
- RLS: Class B (members read, client_admin manages; the public webhook
  handler reads via service role)
- Indexes: unique (token)

### subscription_savings

Client self-managed list of subscriptions they have cancelled. The platform
only sums and displays what the client enters; it verifies nothing.

- id uuid PK
- name text not null
- monthly_cost_pence integer not null
- cancelled_on date not null
- Indexes: (organisation_id)

## Relationships at a glance

- organisations 1..n organisation_memberships n..1 users
- organisations 1..n entitlements, leads, customers, tasks, notes, files,
  templates, automation_rules and the rest of the tenant tables
- plans 1..n plan_modules; organisations n..1 plans (assignment only)
- customers 1..n contacts, 1..n sites, 1..n quotes
- quotes 1..n quote_line_items
- webhook_forms 1..n leads; leads 0..1 customers (on conversion)
- automation_rules 1..n automation_runs
- tasks, notes and files point loosely at records via related_type and
  related_id (no FK, validated in application code)
