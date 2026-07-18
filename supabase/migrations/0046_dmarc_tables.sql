-- DMARC sender monitoring: the five tables plus two helpers. Grouped into one
-- migration (with 0047 for policies) rather than the usual per-table pairing, as
-- one cohesive feature. Raw-XML storage is deferred to slice 2 (the webhook).
--
-- Scoping: a monitored domain belongs to a client, so RLS is operator-scoped via
-- owns_client on dmarc_domains, and via owns_dmarc_domain (below) on the four
-- child tables. The child tables denormalise dmarc_domain_id so RLS stays a
-- single hop.

-- The monitored domains. ingest_address is the per-domain rua mailbox on
-- Spotlight's receiving subdomain (any prefix forwards, so it encodes which
-- domain a report is for); dmarc_record is the exact TXT value setup shows.
create table public.dmarc_domains (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  domain text not null,
  ingest_address text not null,
  dmarc_record text,
  created_at timestamptz not null default now(),
  unique (client_id, domain),
  unique (ingest_address)
);
create index dmarc_domains_client_id_idx on public.dmarc_domains (client_id);

-- Ownership helper for the child tables: true when the DMARC domain belongs to
-- the caller, via its client. Same recursion-safe definer pattern as owns_client
-- (0005). Defined here so 0047's child policies can use it.
create function public.owns_dmarc_domain(p_domain_id uuid)
returns boolean language sql security definer set search_path = '' stable as $$
  select exists (
    select 1
    from public.dmarc_domains d
    join public.clients c on c.id = d.client_id
    where d.id = p_domain_id
      and c.operator_id = (select auth.uid())
  );
$$;

-- Per-domain expected senders, matched by DKIM selector + domain, NEVER by IP.
-- envelope_domain is a nullable secondary signal (e.g. send.taverncreative.com).
create table public.dmarc_known_senders (
  id uuid primary key default gen_random_uuid(),
  dmarc_domain_id uuid not null references public.dmarc_domains (id) on delete cascade,
  label text not null,
  dkim_selector text not null,
  dkim_domain text not null,
  envelope_domain text,
  created_at timestamptz not null default now(),
  unique (dmarc_domain_id, dkim_selector, dkim_domain)
);
create index dmarc_known_senders_domain_idx
  on public.dmarc_known_senders (dmarc_domain_id);

-- One row per parsed report. unique (dmarc_domain_id, report_id) is the
-- idempotency key: a re-ingested report is a no-op via on-conflict at the store.
create table public.dmarc_reports (
  id uuid primary key default gen_random_uuid(),
  dmarc_domain_id uuid not null references public.dmarc_domains (id) on delete cascade,
  report_id text not null,
  org_name text,
  window_begin timestamptz not null,
  window_end timestamptz not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (dmarc_domain_id, report_id)
);
create index dmarc_reports_domain_window_idx
  on public.dmarc_reports (dmarc_domain_id, window_begin desc);

-- One row per <record>. dmarc_domain_id is denormalised from the parent report
-- so RLS and rollup queries stay single-hop. dkim holds every auth_results DKIM
-- block (a record may carry several), so the classifier can scan all of them.
-- classification is derived at store time.
create table public.dmarc_report_records (
  id uuid primary key default gen_random_uuid(),
  dmarc_report_id uuid not null references public.dmarc_reports (id) on delete cascade,
  dmarc_domain_id uuid not null references public.dmarc_domains (id) on delete cascade,
  source_ip inet,
  email_count integer not null default 0,
  header_from text,
  envelope_from text,
  dkim jsonb not null default '[]'::jsonb,
  spf_result text,
  disposition text,
  classification text not null
    check (classification in ('ok', 'unknown', 'broken')),
  created_at timestamptz not null default now()
);
create index dmarc_report_records_report_idx
  on public.dmarc_report_records (dmarc_report_id);
create index dmarc_report_records_domain_class_idx
  on public.dmarc_report_records (dmarc_domain_id, classification);

-- Per-domain, per-day rolled-up state for the 30-day strip and the pill.
-- Recomputed from the records on every ingest (see refresh_dmarc_daily), so it is
-- idempotent and always reflects all reports whose window falls on that day.
create table public.dmarc_daily (
  id uuid primary key default gen_random_uuid(),
  dmarc_domain_id uuid not null references public.dmarc_domains (id) on delete cascade,
  day date not null,
  state text not null check (state in ('ok', 'warn', 'danger')),
  email_count integer not null default 0,
  unknown_count integer not null default 0,
  broken_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (dmarc_domain_id, day)
);
create index dmarc_daily_domain_day_idx
  on public.dmarc_daily (dmarc_domain_id, day desc);

-- Recompute one day's rollup from the records of every report on that day, and
-- upsert it. SECURITY INVOKER (the default): it runs with the caller's rights, so
-- the service-role store path has full access while RLS still scopes an operator
-- caller and anon (no grants) simply cannot write. Idempotent, so re-ingesting
-- the same report leaves the rollup unchanged. Precedence: any broken -> danger,
-- else any unknown -> warn, else ok.
create function public.refresh_dmarc_daily(p_domain_id uuid, p_day date)
returns void language sql set search_path = '' as $$
  insert into public.dmarc_daily (
    dmarc_domain_id, day, state, email_count, unknown_count, broken_count, updated_at
  )
  select
    p_domain_id,
    p_day,
    case
      when coalesce(sum(rr.email_count) filter (where rr.classification = 'broken'), 0) > 0 then 'danger'
      when coalesce(sum(rr.email_count) filter (where rr.classification = 'unknown'), 0) > 0 then 'warn'
      else 'ok'
    end,
    coalesce(sum(rr.email_count), 0),
    coalesce(sum(rr.email_count) filter (where rr.classification = 'unknown'), 0),
    coalesce(sum(rr.email_count) filter (where rr.classification = 'broken'), 0),
    now()
  from public.dmarc_report_records rr
  join public.dmarc_reports r on r.id = rr.dmarc_report_id
  where rr.dmarc_domain_id = p_domain_id
    and (r.window_begin at time zone 'UTC')::date = p_day
  on conflict (dmarc_domain_id, day) do update set
    state = excluded.state,
    email_count = excluded.email_count,
    unknown_count = excluded.unknown_count,
    broken_count = excluded.broken_count,
    updated_at = excluded.updated_at;
$$;
