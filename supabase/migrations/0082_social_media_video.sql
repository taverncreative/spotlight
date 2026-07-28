-- Let video into the social-media bucket.
--
-- 0032 locked this bucket to four image types at 10 MB, matching what the app
-- accepted at the time. social_post_media.media_type has allowed 'video' since
-- 0021, so the schema was always ready; the bucket was the gate, and it is
-- exactly the right place for it to have been. This widens it deliberately
-- rather than by accident.
--
-- FORMATS. mp4 is what Meta recommends for both Instagram Reels and Facebook
-- Reels, and quicktime (.mov) is what phones actually produce. Nothing else:
-- webm and mkv are not accepted by Meta, so allowing them here would move the
-- rejection from a clear browser message to an opaque Graph error minutes into
-- publishing.
--
-- SIZE. 200 MB, against 10 MB before. A 90-second Reel at 1080x1920 lands
-- around 50-150 MB depending on bitrate, so this covers the format with headroom
-- and still refuses a whole camera roll.
--
-- WORTH KNOWING, AND NOT SOLVED HERE: Supabase's standard upload is a single
-- request, and above roughly 50 MB a browser upload over a domestic connection
-- gets slow and fails whole rather than resuming. The bucket ceiling is not the
-- practical ceiling. Resumable (TUS) upload is its own slice; until then the
-- uploader warns above 50 MB rather than pretending 200 MB will be pleasant.
--
-- post-images is deliberately untouched. Blog featured images have no reason to
-- accept video, and widening a bucket nobody asked about is how limits stop
-- meaning anything.
update storage.buckets
set file_size_limit = 209715200, -- 200 MB
    allowed_mime_types = array[
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/quicktime'
    ]
where id = 'social-media';
