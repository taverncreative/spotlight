-- Featured image for a post: the stored public URL of an object in the
-- post-images bucket. Null when the post has no featured image.
alter table public.posts add column featured_image text;
