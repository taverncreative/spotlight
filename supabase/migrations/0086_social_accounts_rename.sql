-- meta_accounts becomes social_accounts, because it stopped being about Meta.
--
-- The table already holds everything a publishing destination needs regardless
-- of who runs it: platform, external_id, display_name, access_token,
-- needs_reconnect, parent_account_id. Only the NAMES were Meta-specific, and a
-- LinkedIn Company Page sitting in a table called meta_accounts, reached through
-- a column called meta_account_id, would be a lie told in two places by every
-- query that touches it.
--
-- DONE NOW, WHILE NOTHING DEPENDS ON IT. Today this is purely mechanical and the
-- diff can be reviewed by not reading it. Done alongside the LinkedIn work it
-- becomes a rename tangled up with new code, which is when a rename stops being
-- safe to skim.
--
-- EVERY STATEMENT HERE IS CATALOGUE-ONLY. No table is rewritten and no row is
-- touched: renames change names, not data. Production holds 4 accounts and 130
-- targets, and neither is read or written by this.
--
-- THIS ONE IS NOT BACKWARDS COMPATIBLE, and that makes it different from every
-- migration before it. The additive ones (0085 most recently) could be applied
-- to production first and deployed after, with old code carrying on unaffected
-- throughout. A rename breaks deployed code the instant it lands, so the
-- migration and the deploy have to go together, at a moment when nothing is
-- scheduled to publish. That sequencing is the actual risk in this slice; the
-- SQL below is the easy half.

-- 1. The table.
alter table public.meta_accounts rename to social_accounts;

-- 2. The foreign key column that names it. Its sibling is post_id, so account_id
--    is the name that matches; social_account_id would restate the table it
--    already points at.
alter table public.social_post_targets
  rename column meta_account_id to account_id;

-- 3. Constraints. Postgres does NOT rename these when the table or column is
--    renamed, so without this the schema would carry meta_ in constraint names
--    forever -- which is exactly where a stale name survives longest, because
--    nothing reads it until an error message quotes it at you.
alter table public.social_accounts
  rename constraint meta_accounts_platform_check to social_accounts_platform_check;
alter table public.social_accounts
  rename constraint meta_accounts_operator_id_fkey to social_accounts_operator_id_fkey;
alter table public.social_accounts
  rename constraint meta_accounts_client_id_fkey to social_accounts_client_id_fkey;
alter table public.social_accounts
  rename constraint meta_accounts_parent_account_id_fkey to social_accounts_parent_account_id_fkey;
alter table public.social_accounts
  rename constraint meta_accounts_pkey to social_accounts_pkey;
alter table public.social_accounts
  rename constraint meta_accounts_platform_external_id_key to social_accounts_platform_external_id_key;

alter table public.social_post_targets
  rename constraint social_post_targets_meta_account_id_fkey to social_post_targets_account_id_fkey;
alter table public.social_post_targets
  rename constraint social_post_targets_post_id_meta_account_id_key to social_post_targets_post_id_account_id_key;

-- 4. Plain indexes. The pkey and unique indexes were renamed by their
--    constraints above; these four have no constraint behind them.
alter index public.meta_accounts_client_id_idx rename to social_accounts_client_id_idx;
alter index public.meta_accounts_operator_id_idx rename to social_accounts_operator_id_idx;
alter index public.meta_accounts_parent_account_id_idx rename to social_accounts_parent_account_id_idx;

-- 5. The policy. Renaming is cosmetic -- the policy follows the table and keeps
--    working under its old name -- but a policy called meta_accounts_operator_all
--    on a table called social_accounts is the kind of thing that makes someone
--    doubt which one is authoritative.
alter policy meta_accounts_operator_all on public.social_accounts
  rename to social_accounts_operator_all;

-- 6. LinkedIn added to the platform check NOW, deliberately, even though nothing
--    writes it yet.
--
--    This is the one line here that is not a rename, and it is included because
--    it is free while the table is already being altered and because it means
--    the LinkedIn slices need no accounts migration at all. Nothing can create a
--    linkedin row until code exists to do it, so widening the check changes no
--    behaviour today.
--
--    Strike this statement if you would rather the value arrived with the code
--    that uses it. The rest of the migration stands without it.
alter table public.social_accounts
  drop constraint social_accounts_platform_check;
alter table public.social_accounts
  add constraint social_accounts_platform_check
    check (platform in ('facebook', 'instagram', 'linkedin'));

-- NO GRANTS CHANGE. scripts/local-reset-grants.sql grants at table level across
-- the public schema rather than per table, so a renamed table is still covered.
