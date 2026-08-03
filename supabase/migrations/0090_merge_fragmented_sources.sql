-- Consolidate the source_app names that had fragmented: bskview onto bsk-view,
-- and gem-crm2 onto gem-crm.
--
-- A DATA MIGRATION, not a schema one, following 0081 (the template seed) as the
-- precedent for that being allowed in this chain. Every statement is written to
-- affect zero rows on a fresh database, so it is a no-op there rather than
-- something that has to be reasoned about.
--
-- WHAT source_app IS, because that decides whether this is safe. It is stamped
-- onto every request, it resolves the operator in create_client_request, and it
-- scopes idempotency through the unique index (source_app, request_id) where
-- request_id is not null. The TOKEN is the credential; source_app is derived
-- from whichever inbound_sources row the token matched. So renaming changes what
-- future requests are stamped with and which rows share an idempotency scope --
-- it does not weaken authentication, and no sender has to do anything.
--
-- MULTIPLE LIVE ROWS PER source_app IS THE SUPPORTED SHAPE. 0043 allows it so a
-- secret can be rotated with an overlap window, and create_client_request picks
-- deterministically (order by default_client_id nulls last, limit 1). So merging
-- bskview onto bsk-view leaves two live secrets that both stamp bsk-view, which
-- is rotation, not breakage. Both keep working.
--
-- ⚠️ WHAT THIS DELIBERATELY DOES NOT DO: it does not revoke the older bsk-view
-- secret. That secret was last used on 21 July and the bskview one is what BSK
-- View is actually sending with now, so the old one looks stale -- but "looks
-- stale" is not "nobody holds it", and revoking a credential another system may
-- still be configured with is an outward-facing decision, not a tidy-up. Revoke
-- it from Settings once BSK View is confirmed to be using the newer secret.

-- 1. The live bskview source becomes bsk-view.
--
-- Scoped to source_app so it catches the row wherever it lives, and it is the
-- only row with that name. Nothing else about the row changes: same secret, same
-- prefix, same operator, so the sender's token keeps working and simply stamps
-- the merged name from the next request onwards.
update public.inbound_sources
   set source_app = 'bsk-view'
 where source_app = 'bskview';

-- 2. gem-crm2 becomes gem-crm, source row and history together.
--
-- Unlike the BSK case there IS history here: one request still carries
-- gem-crm2. Checked before writing this and there is no (gem-crm, request_id)
-- collision, so the backfill cannot violate the unique index. The order matters
-- only for readability -- both statements are in one transaction.
update public.client_requests
   set source_app = 'gem-crm'
 where source_app = 'gem-crm2'
   and not exists (
     -- Belt and braces. If a colliding request_id ever appeared between writing
     -- this and running it, that row is left as gem-crm2 rather than failing the
     -- whole migration: a stranded name is recoverable, a failed deploy at 3am
     -- is worse. Nothing collides today, so this excludes nothing.
     select 1 from public.client_requests existing
      where existing.source_app = 'gem-crm'
        and existing.request_id = public.client_requests.request_id
   );

update public.inbound_sources
   set source_app = 'gem-crm'
 where source_app = 'gem-crm2';

-- 3. bsk-view-e2e is deliberately LEFT ALONE.
--
-- Two revoked rows, no live secret, and zero requests still carrying the name --
-- the e2e rows that did were deleted. They route nothing and appear nowhere but
-- the revoked list in Settings, where they are an accurate record that those
-- secrets existed and were withdrawn. Renaming them would edit that record to
-- tidy a list nobody reads, which is a worse trade than leaving them.
