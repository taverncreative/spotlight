import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Writes one audit_log row. audit_log has no client policies (Class E), so
// this goes through the service role; the actor is always taken from the
// server-side session by the caller, never from client input. A null actor
// records a public, unauthenticated action (for example the public quote
// page), with the source named in the metadata.
export async function writeAuditLog(entry: {
  organisationId: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("audit_log").insert({
    organisation_id: entry.organisationId,
    actor_user_id: entry.actorUserId,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId,
    metadata: entry.metadata ?? {},
  });
  if (error) {
    throw new Error(`audit_log write failed: ${error.message}`);
  }
}
