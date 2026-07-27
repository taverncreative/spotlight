-- Meta title and excerpt as their own fields on a post.
--
-- meta_title is what search results show, and it is not the headline. A title
-- written to read well on the page is often the wrong length or the wrong
-- emphasis for a SERP, and until now the two were the same string with no way to
-- separate them. Null means "not set": the editor prefills the field from the
-- post title and only writes here once it is actually edited, so a stored value
-- always means a deliberate one rather than a stale copy of a headline that has
-- since changed.
--
-- excerpt is the short summary a card or a listing shows. meta_description
-- already exists and is not the same thing: one is written for a search engine,
-- the other for a human scanning a blog index, and using one for both makes both
-- worse.
--
-- CAPS ARE ABOVE THE SEO THRESHOLDS ON PURPOSE. The editor advises at 60 for the
-- meta title with an amber band before it; these constraints sit at 120 and 500.
-- A constraint at 60 would make the warning band unreachable, and the column's
-- job is to stop something absurd, not to enforce an opinion the counter is
-- already expressing.
--
-- No paired policy: posts_operator_all (0012) is a table-wide policy scoped
-- through owns_client(client_id), so it already covers these columns.
alter table public.posts add column meta_title text;
alter table public.posts add column excerpt text;

alter table public.posts
  add constraint posts_meta_title_len
    check (meta_title is null or length(meta_title) <= 120),
  add constraint posts_excerpt_len
    check (excerpt is null or length(excerpt) <= 500);
