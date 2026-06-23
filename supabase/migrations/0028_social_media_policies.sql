-- Storage RLS for the social-media bucket. Public read is served by the bucket's
-- public flag. Operators may read/write objects only under a client folder they
-- own: social-media/{client_id}/{post_id}/<file>. The first path segment is the
-- client id, checked with the shared owns_client helper. The SELECT policy is
-- included from the start so the storage API's remove() (which selects matching
-- objects before deleting) works for operator deletes.
create policy "social_media_operator_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'social-media'
    and public.owns_client(((storage.foldername(name))[1])::uuid)
  );

create policy "social_media_operator_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'social-media'
    and public.owns_client(((storage.foldername(name))[1])::uuid)
  );

create policy "social_media_operator_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'social-media'
    and public.owns_client(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'social-media'
    and public.owns_client(((storage.foldername(name))[1])::uuid)
  );

create policy "social_media_operator_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'social-media'
    and public.owns_client(((storage.foldername(name))[1])::uuid)
  );
