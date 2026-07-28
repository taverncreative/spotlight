-- RLS for social_image_templates: the operator's own templates, nothing else.
--
-- Scoped on operator_id directly rather than through owns_client, because a
-- template with a null client_id belongs to the operator and to no client, and
-- a client join would make those rows unreachable.
alter table public.social_image_templates enable row level security;

create policy social_image_templates_operator_all on public.social_image_templates
  for all to authenticated
  using (operator_id = (select auth.uid()))
  with check (operator_id = (select auth.uid()));
