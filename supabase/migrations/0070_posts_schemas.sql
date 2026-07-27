-- Structured data a post carries, as an array of {type, data} objects.
--
-- AN ARRAY, not one column per schema type, because a post can legitimately
-- carry more than one (an Article and an FAQ describe the same page from two
-- angles) and because a new type should be an editor change, not a migration.
--
-- WHAT DOES *NOT* LIVE HERE: the Article schema. Article is derivable in full
-- from the post's own fields, and storing a derived copy is how it goes stale.
-- The staleness is not hypothetical: publishPost and unpublishPost (list
-- quick-actions in lib/posts/actions.ts) change status and published_at without
-- going near the editor, so a stored Article's datePublished would be wrong the
-- moment a post is published from the list. Article is composed at read time in
-- the content API route instead, from the columns that are already the truth.
--
-- So this column holds only what a human actually decided: FAQ entries today,
-- and whatever else later earns its place.
--
-- NOT NULL DEFAULT '[]' rather than nullable: "no structured data" and "an empty
-- list of structured data" are the same statement, and a nullable jsonb array
-- gives every reader two shapes to handle for one meaning.
--
-- No paired policy: posts_operator_all (0012) is table-wide through
-- owns_client(client_id), so it already covers this column, the same as
-- focus_keyword (0068).

-- The shape guard. Written as a function because a CHECK constraint cannot
-- contain a subquery, and validating "every element is an object with a string
-- type" needs to iterate the array.
--
-- IMMUTABLE is true and required: the result depends only on the argument.
--
-- Worth knowing: a function-based CHECK is evaluated on write only. Changing
-- this function later will NOT re-validate rows already stored, so a tightening
-- of the rules needs its own backfill.
create function public.is_post_schemas(v jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(v) <> 'array' then false
    else coalesce(
      (
        select bool_and(
          jsonb_typeof(e) = 'object'
          and jsonb_typeof(e -> 'type') = 'string'
        )
        from jsonb_array_elements(v) e
      ),
      -- An empty array has no elements to fail, and is the default.
      true
    )
  end;
$$;

alter table public.posts
  add column schemas jsonb not null default '[]'::jsonb;

alter table public.posts
  add constraint posts_schemas_shape check (public.is_post_schemas(schemas));
