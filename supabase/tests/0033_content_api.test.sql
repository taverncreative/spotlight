-- DB-level tests for the content-API read path (migrations 0033-0035).
--
-- Run from the repo root against the LOCAL stack, e.g.:
--   psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" \
--     -f supabase/tests/0033_content_api.test.sql
--
-- The whole run is wrapped in a transaction that ROLLS BACK, so it applies the
-- migrations and seeds fixtures without persisting anything -- safe to run
-- against a live local DB. It never touches prod.
--
-- Proves: a draft is never returned by published_posts / published_post; and
-- content_key_client resolves a client_id only for a matching, unrevoked key on
-- the correct slug (null for revoked, wrong-slug, and another client's key).

\set ON_ERROR_STOP on
begin;

\i supabase/migrations/0033_content_api_keys_table.sql
\i supabase/migrations/0034_content_api_keys_policies.sql
\i supabase/migrations/0035_content_api_functions.sql

-- Reuse a real operator_id (FK -> auth.users) from existing local data.
select operator_id as opid from public.clients limit 1 \gset

insert into public.clients (id, operator_id, name, slug) values
  ('0033aaaa-0000-0000-0000-000000000001', :'opid', 'ZZ Test A 0033', 'zz-test-a-0033'),
  ('0033bbbb-0000-0000-0000-000000000002', :'opid', 'ZZ Test B 0033', 'zz-test-b-0033');

insert into public.posts (client_id, title, slug, body, meta_description, status, published_at) values
  ('0033aaaa-0000-0000-0000-000000000001', 'A Live', 'a-live-1', '# Live body A', 'meta A', 'published', now()),
  ('0033aaaa-0000-0000-0000-000000000001', 'A Draft', 'a-draft-1', '# Draft body A', 'meta draft', 'draft', null),
  ('0033bbbb-0000-0000-0000-000000000002', 'B Live', 'b-live-1', '# Live body B', 'meta B', 'published', now());

-- sha256 of test plaintexts: sptl_keyA_plaintext / sptl_keyB_plaintext / sptl_keyA_revoked
insert into public.client_api_keys (client_id, key_hash, key_prefix) values
  ('0033aaaa-0000-0000-0000-000000000001', '\x75275f668a837ad32ac92b4afdb238cd4b883277aec1cae69ab3843b87f28a92'::bytea, 'sptl_keyA'),
  ('0033bbbb-0000-0000-0000-000000000002', '\x172da7c4b1d9859b055ca3ae402056b83ec2b8efd98441020a6f6b5b37fb9290'::bytea, 'sptl_keyB'),
  ('0033aaaa-0000-0000-0000-000000000001', '\x09f9dca6d047ed63d4e5278503ba5d4979d0f7f1f046306ffad82bd8233903a9'::bytea, 'sptl_keyR');
update public.client_api_keys set revoked_at = now() where key_prefix = 'sptl_keyR';

\echo '================ TEST RESULTS ================'
select '01 list: draft excluded' as test,
  case when not exists (select 1 from public.published_posts('0033aaaa-0000-0000-0000-000000000001') where slug='a-draft-1') then 'PASS' else 'FAIL' end as result
union all select '02 list: published present',
  case when exists (select 1 from public.published_posts('0033aaaa-0000-0000-0000-000000000001') where slug='a-live-1') then 'PASS' else 'FAIL' end
union all select '03 single: draft slug -> 0 rows',
  case when (select count(*) from public.published_post('0033aaaa-0000-0000-0000-000000000001','a-draft-1'))=0 then 'PASS' else 'FAIL' end
union all select '04 single: published slug -> body',
  case when (select body from public.published_post('0033aaaa-0000-0000-0000-000000000001','a-live-1'))='# Live body A' then 'PASS' else 'FAIL' end
union all select '05 list: no cross-client leak',
  case when not exists (select 1 from public.published_posts('0033aaaa-0000-0000-0000-000000000001') where slug='b-live-1') then 'PASS' else 'FAIL' end
union all select '06 key: A key + A slug -> A id',
  case when public.content_key_client('zz-test-a-0033','\x75275f668a837ad32ac92b4afdb238cd4b883277aec1cae69ab3843b87f28a92'::bytea) = '0033aaaa-0000-0000-0000-000000000001'::uuid then 'PASS' else 'FAIL' end
union all select '07 key: A key + B slug -> null (wrong slug)',
  case when public.content_key_client('zz-test-b-0033','\x75275f668a837ad32ac92b4afdb238cd4b883277aec1cae69ab3843b87f28a92'::bytea) is null then 'PASS' else 'FAIL' end
union all select '08 key: B key + A slug -> null (other client)',
  case when public.content_key_client('zz-test-a-0033','\x172da7c4b1d9859b055ca3ae402056b83ec2b8efd98441020a6f6b5b37fb9290'::bytea) is null then 'PASS' else 'FAIL' end
union all select '09 key: B key + B slug -> B id',
  case when public.content_key_client('zz-test-b-0033','\x172da7c4b1d9859b055ca3ae402056b83ec2b8efd98441020a6f6b5b37fb9290'::bytea) = '0033bbbb-0000-0000-0000-000000000002'::uuid then 'PASS' else 'FAIL' end
union all select '10 key: revoked key -> null',
  case when public.content_key_client('zz-test-a-0033','\x09f9dca6d047ed63d4e5278503ba5d4979d0f7f1f046306ffad82bd8233903a9'::bytea) is null then 'PASS' else 'FAIL' end
union all select '11 key: unknown hash -> null',
  case when public.content_key_client('zz-test-a-0033','\xdeadbeef'::bytea) is null then 'PASS' else 'FAIL' end
order by test;

set local role anon;
select '12 anon can call published_posts' as test,
  case when exists (select 1 from public.published_posts('0033aaaa-0000-0000-0000-000000000001')) then 'PASS' else 'FAIL' end as result;
reset role;

\echo '============================================='
rollback;
