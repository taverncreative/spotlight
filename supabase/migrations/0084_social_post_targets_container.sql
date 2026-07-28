-- The Instagram media container a target is waiting on.
--
-- WHY THIS COLUMN EXISTS. Instagram publishing is two-phase: create a container,
-- wait for Meta to finish processing it, then publish it. An image finishes in
-- seconds, so the wait has always fitted inside one request. A Reel does not --
-- Meta's own guidance is to poll for up to five minutes -- and a request that
-- blocks for five minutes inside a cron is not a wait, it is a hostage
-- situation.
--
-- So the wait moves to the cron: create the container, return, and check again
-- on the next tick. That only works if the container id survives between ticks.
-- Without it, every tick would create a NEW container for the same post, and
-- Instagram allows 100 published posts per rolling 24 hours -- a limit that is
-- irrelevant at one post a day and very relevant if a retry loop spends it on
-- containers nobody ever publishes.
--
-- NULL IS THE NORMAL STATE. It means "no container in flight": either nothing
-- has started, or the last one was published or abandoned. It is cleared on
-- success and on a terminal container error (ERROR or EXPIRED), so a stuck row
-- never leaves a dead id behind for the next attempt to poll forever.
--
-- Not a foreign key to anything, and no uniqueness: it is an opaque id belonging
-- to Meta, meaningful only while a container is in flight.
--
-- No paired policy: social_post_targets_operator_all (0026) is table-wide
-- through owns_social_post(post_id), so it already covers this column.
alter table public.social_post_targets
  add column container_id text
    check (container_id is null or length(container_id) between 1 and 100);
