-- A still frame for a video, so lists and the calendar have something to show.
--
-- Every surface that displays social media renders an <img> from storage_path:
-- the post card, the composer grid, the calendar tile, the day detail. Given a
-- video that produces a broken image, not a video player -- and the calendar
-- work in particular was all about the month reading as the pictures going out.
-- A poster is what keeps that true when one of them is a Reel.
--
-- A SEPARATE OBJECT, not a derived path. Convention (video.mp4 ->
-- video.poster.jpg) would need no column, and would mean every reader guessing
-- whether the object exists and 404ing when it does not. A nullable column says
-- so plainly: null means no poster, which is also the honest state for the
-- videos uploaded before this column existed.
--
-- Captured in the BROWSER at upload time, from the first frame, and stored
-- beside the video. Server-side frame extraction means ffmpeg, which is a large
-- binary in a lambda for something a <canvas> already does for free.
--
-- Only meaningful for media_type = 'video'. Not constrained to it: a check tying
-- the two together would have to be rewritten the moment an image wants a
-- derived still for any reason, and the cost of an ignored null on an image row
-- is nothing.
--
-- No paired policy: social_post_media_operator_all (0022) is table-wide through
-- owns_social_post(post_id), so it already covers this column.
alter table public.social_post_media
  add column poster_path text
    check (poster_path is null or length(poster_path) between 1 and 400);
