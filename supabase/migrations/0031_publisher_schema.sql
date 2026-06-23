-- Publisher schema (Slice 20e): the engine's status + per-target safety columns,
-- plus the atomic claim function the run-publisher cron uses.

-- 'partial' is the honest middle state: some targets published, some not, after
-- the engine gives up. New set: draft, scheduled, publishing, published, partial,
-- failed.
alter table public.social_posts
  drop constraint social_posts_status_check,
  add constraint social_posts_status_check
    check (status in (
      'draft', 'scheduled', 'publishing', 'published', 'partial', 'failed'
    ));

-- Set when a publish hits an auth-class error for this account; surfaced on
-- Integrations as "Reconnect needed". Cleared on reconnect (the callback upsert).
alter table public.meta_accounts
  add column needs_reconnect boolean not null default false;

-- Idempotency hardening. Stamped immediately BEFORE the Graph call and cleared on
-- a clean (caught) failure. On reclaim, a target with attempt_started_at set but
-- no platform_post_id was interrupted mid-publish (the process died between the
-- Graph call and recording its result) and must NEVER be auto-reposted — the
-- engine flags it "interrupted — verify on Facebook" for manual resolution.
alter table public.social_post_targets
  add column attempt_started_at timestamptz;

-- Atomic claim for the publisher cron: pick due scheduled posts and stale
-- 'publishing' posts (crash recovery), lock them with FOR UPDATE SKIP LOCKED so
-- concurrent runs never double-claim, and flip them to 'publishing' in the same
-- transaction. SECURITY INVOKER: the service-role cron (BYPASSRLS) claims across
-- all operators; an authenticated caller could only ever affect their own posts
-- (RLS), so no cross-operator exposure and no grants carve-out is needed.
-- attempts is intentionally NOT touched here — the engine increments it once per
-- run in code, so the cron and Publish-now paths count identically.
create function public.claim_due_social_posts(p_stale_minutes int, p_limit int)
returns setof uuid
language sql
security invoker
set search_path = ''
as $$
  with due as (
    select id from public.social_posts
    where (status = 'scheduled' and scheduled_at is not null and scheduled_at <= now())
       or (status = 'publishing' and claimed_at < now() - make_interval(mins => p_stale_minutes))
    order by scheduled_at nulls last
    limit p_limit
    for update skip locked
  )
  update public.social_posts s
  set status = 'publishing', claimed_at = now()
  from due
  where s.id = due.id
  returning s.id;
$$;
