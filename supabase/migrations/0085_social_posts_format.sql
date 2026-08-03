-- What KIND of thing a social post is: a feed post, or a story.
--
-- A story is its own post row rather than a variant of a feed post, because
-- almost nothing about the two is shared beyond the client and the schedule.
-- A story takes no caption, takes exactly one media item, must be 9:16, and
-- disappears after 24 hours. Modelling it as a flag on a feed post would mean
-- every reader asking "but is it a story" before trusting any other field.
--
-- TWO VALUES, NOT THREE. A Reel is deliberately absent. Reels are already
-- derived at publish time from the media itself -- a single video on an
-- Instagram target becomes media_type REELS, a Facebook one goes to
-- /video_reels -- and nothing stores that decision. Adding 'reel' here would
-- create a state nothing writes and every reader would have to handle, which is
-- the kind of speculative column that reads as a feature until someone looks.
-- If a Reel ever needs to be chosen rather than inferred, that is the migration
-- that adds it.
--
-- DEFAULT 'feed', so every existing row keeps meaning exactly what it meant.
-- Not nullable: "we do not know what kind of post this is" is not a state this
-- table should be able to hold.
alter table public.social_posts
  add column format text not null default 'feed'
    check (format in ('feed', 'story'));

-- A story carries no caption, and the database says so rather than trusting
-- every writer to remember.
--
-- None of the three story endpoints accepts message text: Instagram's
-- media_type=STORIES container takes no caption, and Facebook's photo_stories
-- and video_stories take none either. Words reach a story by being part of the
-- picture, which is what the image editor is for.
--
-- So a caption on a story row would be text the operator wrote, saw stored, and
-- watched never appear anywhere. This makes that impossible instead of merely
-- unlikely. caption is NOT NULL DEFAULT '' already, so the empty string is the
-- natural "no caption" value and no existing row is affected.
alter table public.social_posts
  add constraint social_posts_story_has_no_caption
    check (format <> 'story' or caption = '');

-- NO PAIRED POLICY. social_posts_operator_all (0021) is table-wide through
-- owns_client(client_id), so it already covers these columns, exactly as 0083
-- noted for social_post_media.
--
-- NO GRANTS CHANGE. scripts/local-reset-grants.sql grants at table level across
-- the public schema, not per column, so a new column needs nothing there.
--
-- NOT ENFORCED HERE, and stated so it is a decision rather than an oversight:
-- "a story has exactly one media item" spans social_post_media and would need a
-- trigger to express. It is enforced in the save action and at publish time,
-- where the operator can be told why, rather than as a constraint violation
-- surfacing as an opaque failure.
