-- Which services a client is actually on.
--
-- WHY THIS EXISTS. The home cards are getting a neglect score, and without this
-- a client we have never done social for is indistinguishable from one we have
-- neglected: both have zero scheduled posts. Absence of work and absence of a
-- commitment look identical in the data, and only one of them is a problem.
--
-- WHY NOT DERIVE IT. The obvious signals were tested against real rows first:
--
--   * blog_base_url is set on ZERO of ten clients, including the one with four
--     published posts. It cannot imply anything.
--   * client_api_keys does predict blog work with no false negatives today, and
--     meta_accounts does the same for social.
--   * But TavernCreative has two connected Meta accounts and no social posts.
--     Derived, that reads "on social, badly neglected". It is the operator's own
--     company: accounts connected, no social programme.
--
-- That is the distinction. A connected account is a CAPABILITY. A service is a
-- COMMITMENT, and only the operator knows which clients they have made one to.
-- The derivations are good enough to seed from (see 0062) and not good enough to
-- trust standing up.
--
-- text[] rather than one boolean per service: a fifth service later is a change
-- to the constraint below, not a fifth column, and the score and card code just
-- iterate the array.
--
-- No paired policy: clients_operator_all (0003) is a table-wide `for all` on
-- operator_id, so it already covers this column, the same as blog_base_url
-- (0038), retainer_minutes (0054) and the deploy hook columns (0060).
alter table public.clients
  add column services text[] not null default '{}';

-- The known set, which is exactly the four inputs the score reads. Retainer is
-- deliberately absent: under-use of a retainer is ambiguous (an efficient month
-- looks like a neglected one), so it is not scored and does not need modelling.
--
-- `<@` is containment, so it rejects an unknown element while allowing the empty
-- array. It does NOT reject duplicates: a check constraint cannot contain the
-- subquery that would take to express. The scoring function dedupes instead,
-- which is the right place for it, since that is what a duplicate would actually
-- distort (a weighted mean counting one service twice).
alter table public.clients
  add constraint clients_services_known
    check (services <@ array['monitoring', 'blog', 'social', 'requests']::text[]);
