-- ============================================================================
-- Corrective follow-up to scripts/import-taverncreative-journal.sql
--
-- THE BUG. That import stored FAQ entries as {type:'FAQPage', data:{questions}}.
-- The column constraint (is_post_schemas, 0070/0072) accepts it, because all it
-- requires is an object with a string `type`. But the constraint is not the
-- contract: lib/posts/structured-data.ts schemasFromForm is, and it stores the
-- FULL JSON-LD object -- @context, @type and mainEntity -- alongside the raw
-- `questions` rows the editor round-trips through.
--
-- composeSchemas serves entry.data verbatim, so a `data` holding only
-- {questions} reaches the consuming site as a JSON-LD block with no @type and no
-- mainEntity. It is not FAQPage markup, it is not valid JSON-LD, and for
-- TavernCreative it would have been a REGRESSION: those four posts currently
-- emit correct FAQPage from the markdown parser in the TC52 repo.
--
-- Nothing consumed it in between -- the TC52 site is still rendering from files
-- and has not been switched to the API yet -- so this is caught before any
-- crawler saw it.
--
-- THE FIX. Rebuild each entry in schemasFromForm's shape from the questions
-- already stored, so no data is re-derived from markdown and question order is
-- preserved. Idempotent and safe to re-run: it reads `questions`, which the
-- corrected shape still carries, and rewrites the same value.
--
-- RUN:
--   psql "$PROD_DB_URL" --single-transaction -v ON_ERROR_STOP=1 -P pager=off \
--     -f scripts/fix-taverncreative-faq-schemas.sql
-- ============================================================================

update public.posts p
set schemas = jsonb_build_array(
  jsonb_build_object(
    'type', 'FAQPage',
    'data', jsonb_build_object(
      '@context', 'https://schema.org',
      '@type', 'FAQPage',
      'mainEntity', (
        select jsonb_agg(
          jsonb_build_object(
            '@type', 'Question',
            'name', q ->> 'question',
            'acceptedAnswer', jsonb_build_object(
              '@type', 'Answer',
              'text', q ->> 'answer'
            )
          )
        )
        from jsonb_array_elements(p.schemas -> 0 -> 'data' -> 'questions') q
      ),
      -- Kept alongside the schema.org shape for the same reason schemasFromForm
      -- keeps it: the Spotlight editor reads these rows back without having to
      -- reverse-engineer mainEntity.
      'questions', p.schemas -> 0 -> 'data' -> 'questions'
    )
  )
)
from public.clients c
where c.id = p.client_id
  and c.slug = 'taverncreative'
  and jsonb_array_length(p.schemas) > 0
  and jsonb_typeof(p.schemas -> 0 -> 'data' -> 'questions') = 'array';


-- ============================================================================
-- VERIFICATION -- expect 4 rows, each valid_faq = t and questions matching
-- mainEntity length.
-- ============================================================================

select
  p.slug,
  p.schemas -> 0 -> 'data' ->> '@type'                            as faq_type,
  jsonb_array_length(p.schemas -> 0 -> 'data' -> 'mainEntity')    as main_entity,
  jsonb_array_length(p.schemas -> 0 -> 'data' -> 'questions')     as questions,
  (
    p.schemas -> 0 -> 'data' ->> '@type' = 'FAQPage'
    and p.schemas -> 0 -> 'data' ->> '@context' = 'https://schema.org'
    and jsonb_array_length(p.schemas -> 0 -> 'data' -> 'mainEntity')
        = jsonb_array_length(p.schemas -> 0 -> 'data' -> 'questions')
  )                                                               as valid_faq
from public.posts p
join public.clients c on c.id = p.client_id
where c.slug = 'taverncreative'
  and jsonb_array_length(p.schemas) > 0
order by p.published_at desc;
