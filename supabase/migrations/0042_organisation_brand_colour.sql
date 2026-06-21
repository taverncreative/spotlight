-- Per-workspace brand colour (Phase 13, Design Pass 1): the design system drives
-- a single brand accent (active navigation, primary buttons, key highlights,
-- focus rings) from one CSS variable, --brand. This column lets each workspace
-- carry its own accent so the agency can theme a client's workspace to their
-- colour; the app shell sets --brand from it, falling back to a calm default
-- when null, so a changed value re-themes the accent everywhere.
--
-- It is a plain nullable text colour (a hex string such as '#5b5bd6'); null
-- means "use the default". The value is validated and sanitised in the app
-- before it reaches an inline style (lib/brand.ts), so a malformed value can
-- never break out of the custom-property declaration.
--
-- Reads are covered by the existing organisations select policy (members read
-- their own organisation). Writes stay closed for now: the user-session update
-- grant remains restricted to (name, custom_field_definitions); when the brand
-- colour-picker settings UI lands, add brand_color to that column grant and the
-- matching carve-out in scripts/local-reset-grants.sql, the same way the name
-- carve-out is kept in sync. Until then a workspace's brand colour is set by the
-- platform (the seed sets the demo workspace's).

alter table public.organisations
  add column brand_color text;
