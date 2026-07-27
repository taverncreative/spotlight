-- Fix a hole in is_post_schemas (0070): an entry with NO type key at all was
-- accepted.
--
-- THE BUG. The guard tested `jsonb_typeof(e -> 'type') = 'string'`. When the key
-- is absent, `e -> 'type'` is SQL NULL, jsonb_typeof(NULL) is NULL, and
-- `NULL = 'string'` is NULL rather than false. bool_and then IGNORES that null
-- row, so an array whose every element was malformed in exactly this way
-- aggregated to NULL, hit the coalesce meant for the empty-array case, and came
-- back true.
--
-- Caught by testing the constraint against prod rather than reading it:
-- '{"type":"Article"}' (not an array) and '[{"type":123}]' (type not a string)
-- were both correctly rejected, which is what made the accepted '[{"data":{}}]'
-- worth looking at. A guard that rejects two of three malformed shapes reads as
-- working.
--
-- The fix is coalesce on the INNER value, so a missing key is the empty string
-- and compares false like anything else that is not a string.
--
-- IMPACT ON EXISTING DATA: none. All eight posts hold '[]', and nothing has
-- written a schema entry yet. Worth stating because a function-based CHECK is
-- evaluated on write only: replacing this function does NOT re-validate stored
-- rows, so if a bad row already existed this migration would not catch it.
--
-- lib/posts/structured-data.ts parseSchemas drops a typeless entry anyway, so
-- nothing malformed could have reached a client's site. But the constraint is
-- what the column CLAIMS to guarantee, and a guarantee that only holds in the
-- application layer is not one.
create or replace function public.is_post_schemas(v jsonb)
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
          -- coalesce INSIDE, so an absent key is '' and compares false rather
          -- than producing a NULL that bool_and quietly skips.
          and coalesce(jsonb_typeof(e -> 'type'), '') = 'string'
        )
        from jsonb_array_elements(v) e
      ),
      -- An empty array has no elements to fail, and is the default.
      true
    )
  end;
$$;
