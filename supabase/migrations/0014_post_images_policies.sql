-- Storage RLS for the post-images bucket. Public read is served by the bucket's
-- public flag (no select policy needed). Operators may write objects only under
-- a client folder they own: post-images/{client_id}/<file>. The first path
-- segment is the client id, checked with the shared owns_client helper.
create policy "post_images_operator_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'post-images'
    and public.owns_client(((storage.foldername(name))[1])::uuid)
  );

create policy "post_images_operator_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'post-images'
    and public.owns_client(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'post-images'
    and public.owns_client(((storage.foldername(name))[1])::uuid)
  );

create policy "post_images_operator_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'post-images'
    and public.owns_client(((storage.foldername(name))[1])::uuid)
  );
