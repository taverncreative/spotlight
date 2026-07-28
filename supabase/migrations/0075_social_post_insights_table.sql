-- Per-target engagement counts for a published social post.
--
-- ONE ROW PER TARGET, not per post. A post has a Facebook target and an
-- Instagram target, they are separate objects on separate platforms with
-- separate ids, and they do not have the same metrics available. Aggregating
-- them into one row would mean inventing a total across two platforms that count
-- different things.
--
-- WHAT IS ACTUALLY AVAILABLE, verified against the live Graph v25.0 API with a
-- real Business Sorted Kent post before this table was designed:
--
--   Instagram (instagram_basic, already held)
--     like_count      -> likes      WORKS, real numbers (0-4 across BSK's posts)
--     comments_count  -> comments   WORKS
--
--   Facebook (pages_read_engagement, already held)
--     shares          -> shares     WORKS, but absent from the response when
--                                   zero, which is every BSK post so far
--     likes / comments / reactions  REFUSED. These are USER-generated content
--                                   and are governed by pages_read_user_content,
--                                   which this app does not hold. Requesting it
--                                   means App Review.
--
-- NULLABLE COUNTS, AND THE DISTINCTION IS THE POINT. null means "not available
-- for this platform, or not fetched yet". 0 means "fetched, and genuinely zero".
-- Facebook likes will be null forever under the current permissions, and that is
-- not the same statement as a post nobody liked. A non-null default would turn
-- a permission gap into a fact about a client's performance.
create table public.social_post_insights (
  id uuid primary key default gen_random_uuid(),
  -- One row per target, replaced in place on each refresh rather than appended:
  -- this table answers "how is it doing now", and a time series would be a
  -- different table with different costs. Cascade, because an insight about a
  -- deleted target is nothing.
  target_id uuid not null unique
    references public.social_post_targets (id) on delete cascade,

  likes integer check (likes is null or likes >= 0),
  comments integer check (comments is null or comments >= 0),
  shares integer check (shares is null or shares >= 0),

  -- What the API actually returned, kept verbatim. Meta has renamed these fields
  -- repeatedly -- post_impressions is already rejected as "not a valid insights
  -- metric" on v25.0 -- so keeping the raw response means a future rename can be
  -- diagnosed from stored data instead of guessed at.
  raw jsonb not null default '{}'::jsonb,

  -- When the numbers were last successfully read. Null means never: a row can
  -- exist with an error and no counts.
  fetched_at timestamptz,
  -- The last failure, so a permanently failing target is visible rather than
  -- silently stale. Cleared on a successful fetch.
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index social_post_insights_target_id_idx
  on public.social_post_insights (target_id);

-- The refresh worker's claim query: oldest-fetched first, so a backlog drains
-- evenly rather than one target being refreshed repeatedly.
create index social_post_insights_fetched_at_idx
  on public.social_post_insights (fetched_at nulls first);

create trigger set_updated_at
  before update on public.social_post_insights
  for each row execute function public.set_updated_at();
