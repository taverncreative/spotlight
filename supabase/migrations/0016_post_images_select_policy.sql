-- The Storage API's remove() (used by image reaping, Slice 14) selects matching
-- objects before deleting them, so an operator needs select on their own
-- post-images objects for the delete to take effect — without it remove() finds
-- nothing and silently no-ops. Public *read* is still served by the bucket's
-- public flag; this only grants authenticated operators visibility of their own
-- client folders, scoped exactly like the write policies in 0014.
create policy "post_images_operator_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'post-images'
    and public.owns_client(((storage.foldername(name))[1])::uuid)
  );
