-- assign_plan: the only way a plan becomes entitlements. Platform-only;
-- execute is revoked from client roles, so the service role (the BSK admin
-- path) is the sole caller. Clients can never assign their own plan.
--
-- Re-assigning re-materialises the 'plan'-source rows: modules no longer in
-- the plan are removed, newly included ones added. 'add_on'-source rows are
-- never touched. Every call writes an audit_log entry with the before and
-- after module sets.
create function public.assign_plan(org_id uuid, new_plan_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  before_modules text[];
  after_modules text[];
  plan_key text;
begin
  select key into strict plan_key
    from public.plans where id = new_plan_id;

  select coalesce(array_agg(module order by module), '{}')
    into before_modules
    from public.organisation_entitlements
    where organisation_id = org_id;

  delete from public.organisation_entitlements
    where organisation_id = org_id
      and source = 'plan'
      and module not in (
        select module from public.plan_modules where plan_id = new_plan_id
      );

  insert into public.organisation_entitlements (organisation_id, module, source)
    select org_id, pm.module, 'plan'
    from public.plan_modules pm
    where pm.plan_id = new_plan_id
      and not exists (
        select 1
        from public.organisation_entitlements oe
        where oe.organisation_id = org_id
          and oe.module = pm.module
      );

  update public.organisations
    set plan_id = new_plan_id
    where id = org_id;

  select coalesce(array_agg(module order by module), '{}')
    into after_modules
    from public.organisation_entitlements
    where organisation_id = org_id;

  insert into public.audit_log
    (organisation_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    org_id,
    (select auth.uid()),
    'plan.assigned',
    'organisation',
    org_id,
    jsonb_build_object(
      'plan_id', new_plan_id,
      'plan_key', plan_key,
      'before_modules', to_jsonb(before_modules),
      'after_modules', to_jsonb(after_modules)
    )
  );
end;
$$;

revoke execute on function public.assign_plan(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.assign_plan(uuid, uuid) to service_role;
