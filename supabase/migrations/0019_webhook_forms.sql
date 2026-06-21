-- Pass 4A: lead intake from website forms. This adds webhook_forms (one row
-- per public form), completes the last deferred foreign key
-- (leads.webhook_form_id), and gives Postgres a fixed-window rate limiter so
-- the public ingestion endpoint can throttle floods without new
-- infrastructure.

-- webhook_forms: one public lead form per row. The token is the only
-- credential in the public URL, so it is long and unguessable: two random
-- UUIDs as hex give 32 random URL-safe bytes. gen_random_uuid() is core
-- Postgres (already the primary-key default), so no extension is needed.
create table public.webhook_forms (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  name text not null,
  token text not null unique
    default replace(gen_random_uuid()::text, '-', '')
      || replace(gen_random_uuid()::text, '-', ''),
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  -- Composite target for the tenant-scoped reference from leads.
  unique (organisation_id, id)
);

-- The unique constraint on token already indexes it; this is the documented
-- credential lookup path for the public endpoint.

create trigger set_updated_at
  before update on public.webhook_forms
  for each row execute function public.set_updated_at();

-- The last deferred foreign key (see the CLAUDE.md lesson). leads.webhook_form_id
-- was a plain uuid awaiting this table; it now becomes the tenant-scoped
-- composite reference, so a lead can only ever point at a form in its own
-- organisation. MATCH SIMPLE (default) means it is only checked when the
-- column is set, so manually entered leads with a null form stay valid. ON
-- DELETE SET NULL names the nullable column only (Postgres 15+), so deleting
-- a form clears the link and a lead survives, never touching its NOT NULL
-- organisation_id.
alter table public.leads
  add constraint leads_webhook_form_id_fkey
  foreign key (organisation_id, webhook_form_id)
  references public.webhook_forms (organisation_id, id)
  on delete set null (webhook_form_id);

-- Class B RLS: members read their organisation's forms; client_admin and
-- platform staff manage them. The public ingestion endpoint reads forms via
-- the service role, which bypasses RLS, the same sanctioned pattern as the
-- public quote page.
alter table public.webhook_forms enable row level security;

create policy webhook_forms_select_member_or_staff on public.webhook_forms
  for select to authenticated
  using (
    organisation_id in (select public.current_user_org_ids())
    or public.is_platform_staff()
  );

create policy webhook_forms_insert_admin_or_staff on public.webhook_forms
  for insert to authenticated
  with check (
    public.is_org_admin(organisation_id) or public.is_platform_staff()
  );

create policy webhook_forms_update_admin_or_staff on public.webhook_forms
  for update to authenticated
  using (
    public.is_org_admin(organisation_id) or public.is_platform_staff()
  )
  with check (
    public.is_org_admin(organisation_id) or public.is_platform_staff()
  );

create policy webhook_forms_delete_admin_or_staff on public.webhook_forms
  for delete to authenticated
  using (
    public.is_org_admin(organisation_id) or public.is_platform_staff()
  );

-- Fixed-window rate-limit ledger. One row per (scope, key, window); the
-- public endpoint increments the token bucket and the source-IP bucket on
-- every accepted request. Class E: no client policies at all, only the
-- service role (which bypasses RLS) and the function below touch it.
create table public.webhook_rate_limits (
  scope text not null check (scope in ('token', 'ip')),
  bucket_key text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (scope, bucket_key, window_start)
);

alter table public.webhook_rate_limits enable row level security;

-- Atomically count one request against a fixed window and report whether it
-- is within the limit. The window is the request time floored to a multiple
-- of p_window_seconds, so all requests in the same window share one row; the
-- INSERT ... ON CONFLICT increment is atomic under concurrency, so a burst of
-- simultaneous submissions each gets a distinct, correct count. Returns true
-- when the request is allowed (count within the limit), false when it is over
-- and should be rejected with 429. The over-limit request still counts, which
-- is the point of a fixed window.
create function public.webhook_rate_limit_hit(
  p_scope text,
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.webhook_rate_limits (scope, bucket_key, window_start, request_count)
    values (p_scope, p_key, v_window_start, 1)
    on conflict (scope, bucket_key, window_start)
      do update set request_count = public.webhook_rate_limits.request_count + 1
    returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;
