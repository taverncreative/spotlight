-- RLS for the automations configuration model (Phase 10, Pass 10A).
--
-- org_automations is Class B, the same shape as webhook_forms (migration 0019):
-- any member of the workspace may read its automation settings, but only
-- client_admin (or platform staff) may create or change them, because
-- configuring automations is a settings responsibility (settings.manage). The
-- helpers are the SECURITY DEFINER functions from migration 0002, never a direct
-- membership join. There is no delete: an automation is retired by setting
-- enabled false, not by removing the row.
--
-- automation_runs is read-only to members: they may see their workspace's
-- automation history, but no member may write it. With RLS enabled and no
-- insert, update or delete policy, every member write is denied by default; the
-- engine writes runs through the service role in a later pass, which bypasses
-- RLS the same sanctioned way the public endpoints do.

alter table public.org_automations enable row level security;

create policy org_automations_select_member_or_staff on public.org_automations
  for select to authenticated
  using (
    organisation_id in (select public.current_user_org_ids())
    or public.is_platform_staff()
  );

create policy org_automations_insert_admin_or_staff on public.org_automations
  for insert to authenticated
  with check (
    public.is_org_admin(organisation_id) or public.is_platform_staff()
  );

create policy org_automations_update_admin_or_staff on public.org_automations
  for update to authenticated
  using (
    public.is_org_admin(organisation_id) or public.is_platform_staff()
  )
  with check (
    public.is_org_admin(organisation_id) or public.is_platform_staff()
  );

alter table public.automation_runs enable row level security;

create policy automation_runs_select_member_or_staff on public.automation_runs
  for select to authenticated
  using (
    organisation_id in (select public.current_user_org_ids())
    or public.is_platform_staff()
  );
