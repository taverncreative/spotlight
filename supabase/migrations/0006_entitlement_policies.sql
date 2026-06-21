-- RLS for the entitlement layer. Every new table gets RLS enabled; the
-- service role bypasses RLS and is the only write path (Class C) or the
-- only access path at all (Class E).

alter table public.plans enable row level security;
alter table public.plan_modules enable row level security;
alter table public.organisation_entitlements enable row level security;
alter table public.audit_log enable row level security;

-- plans and plan_modules: global catalogue, readable by any signed-in user,
-- written only by the platform (no write policies; service role bypasses).
create policy plans_select_authenticated on public.plans
  for select to authenticated
  using (true);

create policy plan_modules_select_authenticated on public.plan_modules
  for select to authenticated
  using (true);

-- organisation_entitlements: members read their own organisation's rows,
-- only the platform writes (no write policies).
create policy entitlements_select_member_or_staff
  on public.organisation_entitlements
  for select to authenticated
  using (
    organisation_id in (select public.current_user_org_ids())
    or public.is_platform_staff()
  );

-- audit_log: no client access at all (Class E). RLS enabled with no
-- policies denies everything; only the service role reaches this table.
