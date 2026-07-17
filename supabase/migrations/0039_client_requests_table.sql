-- client_requests: inbound feature and change requests from other apps (GEM CRM
-- first), pooled into one triage list.
--
-- RECONCILIATION: this table was applied to prod by hand, outside the migration
-- chain, so this file records what is already there rather than introducing it.
-- Do NOT run it against prod (the table exists); record 0039 in
-- supabase_migrations.schema_migrations instead. It runs for real on a fresh
-- database, which is what makes db:reset reproduce prod again.
--
-- Unlike every other table here, the operator did not create these rows. They
-- arrive from outside over the inbound endpoint, where there is no session, so
-- operator_id is set by create_client_request (0041) rather than defaulted from
-- auth.uid().
--
-- client_id is nullable by design: a request may come from someone who is not a
-- managed Spotlight client, and client_name is what the triage list reads either
-- way. on delete set null so removing a client never destroys the record of what
-- was asked for.
create table public.client_requests (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  source_app text not null,
  -- The sender's own id for this request. Nullable (a sender need not have one),
  -- but when present it makes a retry idempotent via the partial unique index.
  request_id text,
  client_name text not null,
  submitter text,
  type text not null default 'other'
    check (type in ('feature', 'change', 'bug', 'question', 'other')),
  message text not null,
  link text,
  status text not null default 'new'
    check (status in ('new', 'in_progress', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Length caps at the table, not just the route: the endpoint is public, so the
  -- last line of defence against an unbounded write belongs where nothing can
  -- forget it.
  constraint client_requests_message_len
    check (length(message) between 1 and 5000),
  constraint client_requests_client_name_len
    check (length(client_name) between 1 and 200),
  constraint client_requests_source_app_len
    check (length(source_app) between 1 and 64),
  constraint client_requests_submitter_len
    check (submitter is null or length(submitter) <= 200),
  constraint client_requests_link_len
    check (link is null or length(link) <= 500),
  constraint client_requests_request_id_len
    check (request_id is null or length(request_id) <= 128)
);

create index client_requests_operator_status_idx
  on public.client_requests (operator_id, status, created_at desc);
create index client_requests_client_id_idx on public.client_requests (client_id);

-- Idempotency. Partial so senders without a request_id are unconstrained, and
-- scoped by source_app so two senders cannot collide on the same id.
create unique index client_requests_source_ref_idx
  on public.client_requests (source_app, request_id)
  where request_id is not null;

create trigger set_updated_at
  before update on public.client_requests
  for each row execute function public.set_updated_at();
