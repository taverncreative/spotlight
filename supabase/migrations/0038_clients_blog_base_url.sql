-- The public root of this client's blog, e.g. https://businesssortedkent.co.uk/news.
-- Stored without a trailing slash; the post link is {blog_base_url}/{posts.slug}.
-- Null when we do not know where a client's posts live publicly: the /news path
-- is BSK's convention, not a given, so the share caption omits the link rather
-- than guessing a path. No paired policy: clients_operator_all (0003) is a
-- table-wide `for all` on operator_id, so it already covers this column.
alter table public.clients add column blog_base_url text;
