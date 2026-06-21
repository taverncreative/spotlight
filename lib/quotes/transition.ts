import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit";
import { runAutomationsForQuoteTransition } from "@/lib/automations/engine";
import { TRANSITION_AUDIT_ACTIONS } from "./transitions";

// The single point a quote transition is committed (Pass 10D). Every path that
// moves a quote between statuses funnels through here: the in-app
// transitionQuoteStatus action (user session) and the public accept/decline
// (service role). It applies the status-guarded update, audits it when it took
// effect, and fires the quote-lifecycle automations once for an accepted or
// declined transition. So the automation fires exactly once per real transition
// regardless of path, and is not bolted onto each caller.
//
// The caller supplies the client (user session or service role), the changes it
// wants written and the audit actor; the status guard (only update a row still in
// the from-status), the audit and the automation fire live here. The fire is
// best-effort: a failure must not undo the transition that just committed, so it
// is logged and swallowed, the same contract as the lead-created fire. The
// exactly-once guarantee is the database's (the automation_runs unique key).
export async function commitQuoteTransition(
  supabase: SupabaseClient,
  params: {
    organisationId: string;
    quoteId: string;
    from: string;
    to: string;
    changes: Record<string, unknown>;
    auditActorUserId: string | null;
    auditSource?: string;
    selectColumns: string;
  }
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("quotes")
    .update(params.changes)
    .eq("organisation_id", params.organisationId)
    .eq("id", params.quoteId)
    .eq("status", params.from)
    .is("deleted_at", null)
    .select(params.selectColumns)
    .maybeSingle();
  if (error) throw new Error(error.message);
  // Nothing applied: the row was no longer in the from-status (a race, or it
  // already moved). No audit and no fire.
  if (!data) return null;

  await writeAuditLog({
    organisationId: params.organisationId,
    actorUserId: params.auditActorUserId,
    action: TRANSITION_AUDIT_ACTIONS[params.to],
    targetType: "quote",
    targetId: params.quoteId,
    metadata: params.auditSource
      ? { from: params.from, to: params.to, source: params.auditSource }
      : { from: params.from, to: params.to },
  });

  if (params.to === "accepted" || params.to === "declined") {
    try {
      await runAutomationsForQuoteTransition(
        params.organisationId,
        params.quoteId,
        params.to
      );
    } catch (automationError) {
      console.error(
        `Automations engine failed for quote.${params.to}`,
        automationError
      );
    }
  }

  return data as unknown as Record<string, unknown>;
}
