-- Security hardening: bucket-level upload enforcement and removal of the
-- over-wide default API-role grants. No schema or policy changes.
-- KEEP IN SYNC WITH scripts/local-reset-grants.sql (which re-asserts grant
-- state after a local reset and must not re-widen what this revokes).

-- 1. Enforce size and MIME limits at the bucket, matching the app's client-side
-- checks (lib/social/schemas.ts: 10 MB; lib/posts/image-upload.ts: 5 MB).
-- Applies to new uploads only; existing objects and all reads are unaffected.
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif']
where id = 'social-media';

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif']
where id = 'post-images';

-- 2. The anon (publishable) key gets no table access at all: RLS already denies
-- it every row, but TRUNCATE is not governed by RLS, so the grant layer is the
-- only fence there. Also stop future tables inheriting anon grants by default.
revoke all on all tables in schema public from anon;
alter default privileges for role postgres in schema public
  revoke all on tables from anon;

-- Operator JWTs keep their DML (the whole app runs through them via the SSR
-- client) but lose what RLS cannot police or PostgREST cannot express:
-- TRUNCATE (RLS-exempt), REFERENCES and TRIGGER (DDL-adjacent). The same
-- default-privileges treatment stops new tables reintroducing the hole. The
-- users full_name column-level UPDATE grant (0001) is a separate column ACL
-- and survives these table-level revokes untouched.
revoke truncate, references, trigger on all tables in schema public
  from authenticated;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from authenticated;
