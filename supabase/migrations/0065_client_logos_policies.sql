-- Storage RLS for the client-logos bucket, mirroring post-images (0014, 0016).
-- Public read is served by the bucket's public flag; these four scope every
-- authenticated operation to a client folder the operator owns:
-- client-logos/{client_id}/<file>. The first path segment is the client id,
-- checked with the shared owns_client helper, so a foreign or invented id
-- matches nothing and the write is denied.
--
-- select is included for the same reason 0016 had to add it to post-images after
-- the fact: the Storage API's remove() SELECTS matching objects before deleting
-- them, so without it replacing a logo would silently leave the old object
-- behind. Learning that lesson twice would be careless.
create policy "client_logos_operator_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'client-logos'
    and public.owns_client(((storage.foldername(name))[1])::uuid)
  );

create policy "client_logos_operator_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-logos'
    and public.owns_client(((storage.foldername(name))[1])::uuid)
  );

create policy "client_logos_operator_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'client-logos'
    and public.owns_client(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'client-logos'
    and public.owns_client(((storage.foldername(name))[1])::uuid)
  );

create policy "client_logos_operator_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'client-logos'
    and public.owns_client(((storage.foldername(name))[1])::uuid)
  );
