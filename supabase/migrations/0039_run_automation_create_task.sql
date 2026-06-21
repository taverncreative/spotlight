-- The automations engine's atomic claim-and-create (Phase 10, Pass 10B).
--
-- This is the heart of the exactly-once guarantee. In one transaction it claims
-- the run (insert into automation_runs, guarded by the once-per-record unique
-- key) and, only if the claim is new, creates the follow-up task. So either both
-- happen or neither, and a second event for the same record inserts no run and
-- creates no task (it returns null). The task is created as a system action, with
-- created_by left null, because the trigger may be the public lead webhook (no
-- user) or a creator without task-write; this is why it is SECURITY DEFINER and
-- not the user-role-gated createTask. The created task is an ordinary org task
-- (status open, linked to the record), visible in the tasks list and on the lead.
--
-- The due date is computed server-side as now() plus the configured number of
-- days, so it does not depend on the caller's clock.

create function public.run_automation_create_task(
  p_org_id uuid,
  p_automation_type text,
  p_related_type text,
  p_related_id uuid,
  p_task_title text,
  p_days_until_due integer,
  p_assignee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_task_id uuid;
begin
  insert into public.automation_runs
    (organisation_id, automation_type, related_type, related_id)
  values (p_org_id, p_automation_type, p_related_type, p_related_id)
  on conflict (organisation_id, automation_type, related_type, related_id)
    do nothing
  returning id into v_run_id;

  -- Already fired for this record: a clean no-op, no task created.
  if v_run_id is null then
    return null;
  end if;

  insert into public.tasks
    (organisation_id, title, status, due_at, assigned_to, related_type, related_id)
  values (
    p_org_id,
    p_task_title,
    'open',
    now() + (p_days_until_due * interval '1 day'),
    p_assignee_id,
    p_related_type,
    p_related_id
  )
  returning id into v_task_id;

  return v_task_id;
end;
$$;

-- This function bypasses RLS (SECURITY DEFINER) and takes the organisation id as
-- an argument, so only the engine, which runs under the service role, may call
-- it; a user session must never reach it. The blanket local grant in
-- scripts/local-reset-grants.sql re-grants execute on every routine after a
-- reset, so that file carries a matching carve-out (KEEP IN SYNC).
revoke execute on function public.run_automation_create_task(
  uuid, text, text, uuid, text, integer, uuid
) from public, anon, authenticated;
grant execute on function public.run_automation_create_task(
  uuid, text, text, uuid, text, integer, uuid
) to service_role;
