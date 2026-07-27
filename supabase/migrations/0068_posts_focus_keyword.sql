-- The focus keyword a post is written to rank for, and the thing the SEO
-- checklist scores everything else against.
--
-- Null means "not set", which is not the same as a keyword that scores badly:
-- with no keyword there is nothing to check, so the checklist reports no score
-- at all rather than zero. Same distinction the client health score makes for a
-- client with no services.
--
-- NOT added to the content API (0035, 0067) on purpose, unlike meta_title and
-- excerpt. A focus keyword is an editorial aid for whoever writes the post; it
-- is not something a client's site renders, and exposing it would put an
-- internal working note on a public endpoint for no one's benefit. That also
-- keeps this migration off the drop-and-recreate path those functions need.
--
-- No paired policy: posts_operator_all (0012) is table-wide through
-- owns_client(client_id), so it already covers this column.
alter table public.posts add column focus_keyword text;

alter table public.posts
  add constraint posts_focus_keyword_len
    check (focus_keyword is null or length(focus_keyword) between 1 and 120);
