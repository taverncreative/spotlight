-- Alt text for the featured image: describes the image for screen readers and
-- SEO on consuming sites. Null when the post has no featured image or the
-- operator has not written one.
alter table public.posts add column featured_image_alt text;
