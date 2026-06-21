import "server-only";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { requirePermission } from "@/lib/authorisation";
import { createClient } from "@/lib/supabase/server";

// The workspace's active members, id and name, for any feature that needs to
// pick a member (the tasks assignee picker, the automations assignee picker, and
// future ones). It was first written inside the tasks actions and so was gated on
// the tasks module; it is generalised here, gated only on a normal record.read,
// which every member has, plus the co-member visibility rule (migration 0025).
// So it is available to any feature without coupling that feature to tasks.
//
// Co-member visibility is an RLS rule, so this reads through the normal user
// session rather than the service role. Members may read their organisation's
// member list and their co-members' rows, and the users column grant exposes only
// id, full_name and email, so a name falls back to the email when full_name is
// unset (for example a freshly created user) and the picker is never blank.

export type OrganisationMember = { id: string; name: string };

export async function listOrganisationMembers(
  orgSlug: string
): Promise<OrganisationMember[]> {
  const { organisation, membership } = await requireWorkspaceAccess(orgSlug);
  requirePermission(membership, "record.read");

  const supabase = await createClient();
  // Two reads rather than an embed: organisation_memberships has more than one
  // foreign key to users (user_id and invited_by), so a users(...) embed is
  // ambiguous. Read the active members' ids, then their names.
  const { data: rows, error } = await supabase
    .from("organisation_memberships")
    .select("user_id")
    .eq("organisation_id", organisation.id)
    .eq("status", "active");
  if (error) throw new Error(error.message);

  const ids = (rows as { user_id: string }[]).map((row) => row.user_id);
  if (ids.length === 0) return [];

  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, full_name, email")
    .in("id", ids);
  if (usersError) throw new Error(usersError.message);

  type UserRow = { id: string; full_name: string | null; email: string | null };
  return (users as UserRow[])
    .map((user) => ({
      id: user.id,
      name: user.full_name?.trim() || user.email || "Unknown",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
