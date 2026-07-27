-- Storage bucket for client logos. Public read; writes are gated by the policies
-- in 0065. Created via migration so db:reset reproduces it, exactly as
-- post-images (0013) and social-media (0027) are.
--
-- Size and MIME limits are set HERE rather than in a later hardening pass. 0032
-- had to go back and add them to the two existing buckets after the fact; there
-- is no reason to repeat that. 2 MB is deliberately tighter than post-images'
-- 5 MB: a logo renders at 44px on the card, and anything approaching a megabyte
-- is a photograph someone has mistaken for a logo.
--
-- SVG is deliberately absent from the MIME list even though it is the obvious
-- logo format. An SVG is a document, not an image: it can carry script, and this
-- bucket is public-read and served from the same origin as the app. Raster only
-- until there is a sanitising step worth trusting.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-logos',
  'client-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;
