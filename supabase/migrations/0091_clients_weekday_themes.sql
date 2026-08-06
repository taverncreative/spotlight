-- The weekly social rhythm: what each weekday is FOR, per client.
--
-- Social is planned by theme and repeated across the month -- Monday reviews,
-- Tuesday real weddings -- and until now that lived only in the operator's head.
-- Shown above the day columns on the social calendar, it turns an empty Tuesday
-- from "nothing scheduled" into "no real wedding this week", which is a
-- different and more useful kind of gap.
--
-- WHY A COLUMN, NOT A TABLE. Seven fixed slots per client is a shape, not a
-- collection. A client_weekday_themes table would need a table/policy pair, a
-- unique constraint on (client_id, weekday), insert-or-delete logic for blanking
-- a day, and a join on every calendar read -- all to model something with no
-- cardinality question in it. Same reasoning that made services (0061) an array.
--
-- MONDAY FIRST, index 0..6. monthGrid and the calendar's WEEKDAYS row are both
-- Monday-first, so the array index IS the grid column index and nothing has to
-- map between the two. A Sunday-first array would put that mapping in every
-- reader, and one reader would eventually get it wrong.
--
-- BLANK IS '', NOT NULL. A theme is optional, and Postgres arrays can hold
-- nulls, but then "no theme" has two representations and every reader has to
-- handle both. One representation: empty string. The UI trims and the calendar
-- renders nothing for it.
--
-- RELABELLING IS RETROSPECTIVE AND THAT IS INTENDED. There is no per-month or
-- per-week history here: the label describes what a weekday is for, not what
-- went out on a particular one. Renaming Tuesday changes every past Tuesday's
-- heading, which is correct -- the posts are the history, the theme is the
-- intent.
--
-- No paired policy file: clients_operator_all (0003) is a table-wide `for all`
-- on operator_id and already covers this column, as it does services (0061) and
-- the deploy hook columns (0060).
alter table public.clients
  add column weekday_themes text[] not null
    default array_fill(''::text, array[7]);

-- Exactly seven, always. Readers index this by grid column, so a short array
-- would be an out-of-bounds read in the UI rather than a caught error; the
-- constraint keeps that impossible at the source. Nulls are rejected for the
-- same reason blank is '' -- one representation of "no theme".
--
-- No per-element length cap here: a check constraint cannot express
-- "every element is at most 24 characters" without a subquery. The cap lives in
-- the Zod schema and on the inputs. This constraint guarantees SHAPE, which is
-- what the indexing readers depend on, not brevity, which is a layout concern.
alter table public.clients
  add constraint clients_weekday_themes_shape
    check (
      cardinality(weekday_themes) = 7
      and array_position(weekday_themes, null) is null
    );
