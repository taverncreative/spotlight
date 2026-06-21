-- Per-workspace logo (Design Pass 4, the public quote page): the customer-facing
-- quote at /q/[token] presents as the client's own document, so it shows the
-- client organisation's logo when one is set, falling back to the business name.
-- This column carries that logo as a URL (e.g. an uploaded asset or a hosted
-- image); null means "no logo, show the name".
--
-- It mirrors brand_color (migration 0042): a plain nullable text value set by the
-- platform for now. Reads are covered by the existing organisations select policy
-- (members read their own organisation) and the public page reads it via the
-- service role alongside the brand colour. Writes stay closed: the user-session
-- update grant remains restricted to (name, custom_field_definitions); when a
-- branding settings UI lands, add logo_url to that column grant and the matching
-- carve-out in scripts/local-reset-grants.sql, the same way the name carve-out is
-- kept in sync. The value reaches an <img src>, not a CSS declaration, so it does
-- not need the brand_color hex sanitisation; until a settings UI exists it is only
-- ever set by the trusted platform/seed.

alter table public.organisations
  add column logo_url text;
