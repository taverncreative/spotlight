-- Seed the BSK look as the first template.
--
-- A DATA migration, separate from 0077 for the same reason 0062 was separate
-- from 0061: the table is permanent, this row is a starting point the operator
-- will edit, and the moment they do, this file stops describing reality.
--
-- EVERY TYPE NUMBER HERE WAS MEASURED off a real BSK image (the yellow wall
-- post, 1086x1448, chosen because a plain ground means nothing interferes with
-- the measurement):
--
--   cap height   147.2px / 1086 wide = 0.1355   of canvas WIDTH
--   line pitch   162.5px / 147.2 cap = 1.104    of cap height
--   left margin   68px   / 1086 wide = 0.0626
--   first line   215px   / 1448 tall = 0.1485
--
-- Cap height rather than font size because the em is invisible and cannot be
-- measured off a finished image; sizing by em produced type 43% too small.
-- Width rather than height because BSK's originals are three different ratios.
--
-- THE HIGHLIGHT IS ON, which the originals are not. They were composed onto a
-- yellow wall and an empty sky; most photos have no such quiet area, and a white
-- block with black type is the treatment that survives one that does not. It was
-- chosen by comparing it against a black block and against a 45% black scrim on
-- the same busy photo.
--
-- Canvas is 1122x1402, the ratio 13 of BSK's 17 measured images already use, and
-- Instagram's tallest feed size.
--
-- client_id is NULL: the look is available to every client rather than pinned to
-- BSK. Nothing about it is BSK-specific once the words change.
--
-- SCOPED TO OPERATORS WHO ACTUALLY OWN CLIENTS. There are two rows in
-- auth.users: one with eleven clients and a recent sign-in, and one with no
-- clients that has never signed in. Seeding both would put a template in an
-- account that has nothing to use it on, which is the sort of stray row that
-- later gets mistaken for a real one.
--
-- Only inserts when the operator has no template at all, so re-running cannot
-- duplicate it or overwrite an edited one -- a data migration is exactly the
-- kind of thing that gets run twice.
insert into public.social_image_templates
  (operator_id, client_id, name, canvas_width, canvas_height, style)
select
  u.id,
  null,
  'Condensed headline',
  1122,
  1402,
  jsonb_build_object(
    'scrim', 'none',
    'scrimOpacity', 0.35,
    'colour', '#111111',
    'weight', 400,
    'x', 0.0626,
    'y', 0.1485,
    'width', 0.9,
    'capHeight', 0.1355,
    'leading', 1.104,
    'highlight', true,
    'highlightColour', '#FFFFFF',
    'highlightOpacity', 1,
    'highlightPadX', 0.12
  )
from auth.users u
where exists (
  select 1 from public.clients c where c.operator_id = u.id
)
and not exists (
  select 1 from public.social_image_templates t where t.operator_id = u.id
);
