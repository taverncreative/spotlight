import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getAutomation,
  isAutomationRunnable,
  type AutomationEvent,
} from "@/lib/automations/catalogue";

// The automations engine (Phase 10, Pass 10B). When something happens that an
// automation can react to (the first event is a lead being created), this finds
// the organisation's enabled automations whose trigger matches the event and
// performs each one's action exactly once.
//
// It is a system component and runs under the service role (createAdminClient),
// a sanctioned surface alongside audit-log writes, the public quote page and the
// lead webhook: the trigger may be the public webhook with no user, and the task
// is created as a system action regardless of who (if anyone) caused the event.
// The exactly-once guarantee is the database's: the claim-and-create function
// run_automation_create_task inserts the automation_runs row under the
// once-per-record unique key and creates the task in the same transaction, so a
// repeat event for the same record is a clean no-op.
//
// Reading config or firing must never undo the record that was just created, so
// the call sites treat a failure here as best-effort (logged, not fatal). A
// missed firing is acceptable; a double firing is what the unique key prevents.

type LeadCreatedContext = {
  organisationId: string;
  leadId: string;
};

export async function runAutomationsForLeadCreated(
  context: LeadCreatedContext
): Promise<void> {
  await runEnabledAutomationsForEvent("lead.created", context.organisationId, {
    relatedType: "lead",
    relatedId: context.leadId,
  });
}

// A quote transitioning to accepted or declined (Pass 10D). Fired from the single
// commit point both transition paths share (lib/quotes/transition.ts), so it runs
// once per real transition regardless of path; the unique key makes it once per
// quote ever.
export async function runAutomationsForQuoteTransition(
  organisationId: string,
  quoteId: string,
  transition: "accepted" | "declined"
): Promise<void> {
  const event: AutomationEvent =
    transition === "accepted" ? "quote.accepted" : "quote.declined";
  await runEnabledAutomationsForEvent(event, organisationId, {
    relatedType: "quote",
    relatedId: quoteId,
  });
}

async function runEnabledAutomationsForEvent(
  event: AutomationEvent,
  organisationId: string,
  subject: { relatedType: string; relatedId: string }
): Promise<void> {
  const admin = createAdminClient();

  // The organisation must have the automations module; otherwise a clean no-op.
  const { data: entitlement, error: entitlementError } = await admin
    .from("organisation_entitlements")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("module", "automations")
    .maybeSingle();
  if (entitlementError) throw new Error(entitlementError.message);
  if (!entitlement) return;

  // The organisation's enabled automations.
  const { data: rows, error } = await admin
    .from("org_automations")
    .select("automation_type, config")
    .eq("organisation_id", organisationId)
    .eq("enabled", true);
  if (error) throw new Error(error.message);
  if (!rows || rows.length === 0) return;

  for (const row of rows) {
    const type = getAutomation(row.automation_type);
    if (!type || !isAutomationRunnable(type)) continue;
    if (type.trigger.kind !== "event" || type.trigger.event !== event) continue;

    if (type.actionKind === "create_task") {
      await runCreateTaskAutomation(
        admin,
        organisationId,
        type.key,
        subject,
        (row.config ?? {}) as Record<string, unknown>
      );
    }
  }
}

// The create_task action, shared by every create_task automation (lead follow-up,
// quote accepted, quote declined): create a task linked to the subject record,
// using the configured title and a due date of now plus the configured days. The
// assignee is honoured only if it is still an active member of the organisation
// (it may have changed since the automation was configured), otherwise the task
// is left unassigned. The claim and the create are atomic in the database
// function, which keys the run on the automation type and the subject record.
async function runCreateTaskAutomation(
  admin: ReturnType<typeof createAdminClient>,
  organisationId: string,
  automationType: string,
  subject: { relatedType: string; relatedId: string },
  config: Record<string, unknown>
): Promise<void> {
  const title =
    typeof config.task_title === "string" ? config.task_title.trim() : "";
  const days =
    typeof config.days_until_due === "number" ? config.days_until_due : null;
  // Misconfigured (no title or no day count): nothing to create.
  if (title === "" || days === null) return;

  let assignee: string | null = null;
  const configuredAssignee = config.assignee_id;
  if (typeof configuredAssignee === "string" && configuredAssignee !== "") {
    const { data: member } = await admin
      .from("organisation_memberships")
      .select("user_id")
      .eq("organisation_id", organisationId)
      .eq("user_id", configuredAssignee)
      .eq("status", "active")
      .maybeSingle();
    if (member) assignee = configuredAssignee;
  }

  const { error } = await admin.rpc("run_automation_create_task", {
    p_org_id: organisationId,
    p_automation_type: automationType,
    p_related_type: subject.relatedType,
    p_related_id: subject.relatedId,
    p_task_title: title,
    p_days_until_due: days,
    p_assignee_id: assignee,
  });
  if (error) throw new Error(error.message);
}
