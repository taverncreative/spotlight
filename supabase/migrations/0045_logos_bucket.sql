-- The logos storage bucket and its access rules (Branding settings, part 2).
--
-- Real application infrastructure (the bucket and its access rules must exist in
-- production too), so it lives in the migration chain, NOT in the local-only
-- reset grants (scripts/local-reset-grants.sql).
--
-- Unlike the private 'attachments' bucket, logos are PUBLIC-READ: the
-- customer-facing quote page (app/q/[token]) is unauthenticated, so it must be
-- able to load the client's logo, and the same raster is embedded in the quote
-- PDF. Reads are public; writes are restricted to a client_admin acting on their
-- OWN workspace's path, mirroring the per-workspace path isolation proven for
-- attachments (migrations 0030 and 0033) but admin-only, since a logo is a
-- branding setting (settings.manage = client_admin).
--
-- Path convention: organisation_id/<object>, so the workspace is the first path
-- segment and storage RLS enforces isolation from it; (storage.foldername(name))[1]
-- is the organisation id. Only PNG and JPEG are accepted (pdf-lib embeds raster,
-- not SVG), and the bucket caps the size at 2 MiB (keep in step with
-- MAX_LOGO_BYTES in lib/logo.ts). There is no update policy: a logo is replaced by
-- upload-then-delete (a new unique object name), not renamed in place.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('logos', 'logos', true, 2097152, array['image/png', 'image/jpeg'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

-- Public read: anyone (including the unauthenticated quote page) may read a logo.
create policy logos_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'logos');

-- Insert is a client_admin acting on their own workspace's path. is_org_admin is
-- the recursion-safe client_admin helper (migration 0002); the organisation is
-- matched by comparing the path's first segment as text against the caller's
-- active organisations, so a malformed path matches nothing rather than erroring,
-- and the admin check is only ever evaluated against a genuine membership uuid.
create policy logos_admin_insert_own_org on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos'
    and exists (
      select 1 from public.current_user_org_ids() as org_id
      where org_id::text = (storage.foldername(name))[1]
        and public.is_org_admin(org_id)
    )
  );

create policy logos_admin_delete_own_org on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'logos'
    and exists (
      select 1 from public.current_user_org_ids() as org_id
      where org_id::text = (storage.foldername(name))[1]
        and public.is_org_admin(org_id)
    )
  );
