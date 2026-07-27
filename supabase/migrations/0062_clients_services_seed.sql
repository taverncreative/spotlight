-- Seed services from the configuration that already exists, so the operator
-- corrects a handful of rows rather than ticking ten clients by four boxes.
--
-- A DATA migration, not a schema one. It is separate from 0061 on purpose: the
-- column is permanent, this is a one-off best guess that stops being true the
-- moment the operator edits anything.
--
-- Each derivation was checked against production rows before being trusted:
--
--   monitoring  a site row with monitoring_enabled. Eight clients. The weakest
--               of the four, since a site row may only mean we know their URL,
--               but monitoring genuinely does run for all of them.
--   blog        a live content API key. Five clients, and every client with a
--               published post has one, so no false negatives.
--   social      a connected Meta account. Two clients, same story.
--   requests    an inbound request has actually been routed to them. One client
--               (GEM). Deliberately narrow: unlike the others there is no
--               configuration that says "we take requests for this client", so
--               only demonstrated history counts.
--
-- KNOWN FALSE POSITIVE, left in on purpose rather than special-cased: this will
-- mark TavernCreative as on social, because it has two connected Meta accounts
-- and no social programme. It is the operator's own company. Hard-coding an
-- exception into a migration would hide exactly the judgement this column exists
-- to capture; untick it in the client editor.
--
-- Only touches rows still at the default. Re-running cannot overwrite an
-- operator's edit, which matters because a data migration is the kind of thing
-- that gets run twice.
update public.clients c
set services = coalesce(
  (
    select array_agg(service order by service)
    from (
      select 'monitoring'::text as service
      where exists (
        select 1 from public.sites s
        where s.client_id = c.id and s.monitoring_enabled
      )
      union all
      select 'blog'
      where exists (
        select 1 from public.client_api_keys k
        where k.client_id = c.id and k.revoked_at is null
      )
      union all
      select 'social'
      where exists (
        select 1 from public.meta_accounts m where m.client_id = c.id
      )
      union all
      select 'requests'
      where exists (
        select 1 from public.client_requests r where r.client_id = c.id
      )
    ) derived
  ),
  '{}'
)
where c.services = '{}';
