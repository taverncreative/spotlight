"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sourceHasDefault } from "@/lib/inbound/actions";

// Triage status moves for the inbound requests inbox.
//
// A plain form action, mirroring publishPost/unpublishPost on the blog cards: it
// surfaces no result, it just moves the row and revalidates the list.
//
// RLS (client_requests_operator_update, 0040) scopes every write to the
// operator's own rows, so a foreign id simply matches nothing. getUser() is
// still explicit rather than trusted from the layout: a server action is a
// public POST endpoint in its own right, and the layout's gate does not stand in
// front of it.

// Not exported: a "use server" module may only export async functions, so a
// const array here is a runtime error the typechecker does not catch. Nothing
// outside needs it, and if something ever does it belongs in a plain module.
const REQUEST_STATUSES = ["new", "in_progress", "done", "archived"] as const;
type RequestStatus = (typeof REQUEST_STATUSES)[number];

export async function updateRequestStatus(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  // Validate against the set rather than passing the field through: the column's
  // check constraint would reject anything else anyway, but that would surface
  // as an opaque failure instead of a no-op.
  if (!id || !REQUEST_STATUSES.includes(status as RequestStatus)) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("client_requests").update({ status }).eq("id", id);
  revalidatePath("/requests");
}

// Attach an unassigned request to a client.
//
// Inbound requests arrive from other apps and carry a free-text client_name, so
// client_id is null unless the sender named a slug we manage. Today that is
// every row, which means nothing inbound is visible on a per-client view until
// it is assigned here.
//
// The client is looked up FIRST, under the operator's session, and the update
// only runs if that returns a row. RLS on client_requests governs which request
// may be written, but it says nothing about which client_id may be written INTO
// it, so without this check a crafted id could file a request under another
// operator's client. Reading the client through RLS is what makes that
// impossible rather than merely unlikely.
export async function assignRequestToClient(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const clientId = String(formData.get("client_id") ?? "");
  if (!id || !clientId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return;

  // Read the source before the update, because assigning moves the row off this
  // page and there is no second chance to know where it came from.
  const { data: request } = await supabase
    .from("client_requests")
    .select("source_app")
    .eq("id", id)
    .maybeSingle();

  await supabase
    .from("client_requests")
    .update({ client_id: clientId })
    .eq("id", id);

  revalidatePath("/requests");
  // The home grid counts and the unassigned strip both move with this.
  revalidatePath("/home");

  // OFFER TO REMEMBER, rather than learning silently.
  //
  // One assignment quietly rewriting where every future request from that source
  // lands would be a routing change nobody chose and nowhere obvious to see it.
  // So the offer is carried back as a query param and the page asks. Only when
  // the source has no default yet: once it knows, there is nothing to offer.
  if (request?.source_app && !(await sourceHasDefault(request.source_app))) {
    redirect(
      `/requests?remember=${encodeURIComponent(request.source_app)}&client=${clientId}`
    );
  }
}

// Delete an inbound request, and only one that reached no client.
//
// The narrowing is enforced by RLS (client_requests_operator_delete, 0087):
// the policy's using clause is `operator_id = auth.uid() and client_id is null`,
// so an assigned request simply matches no row and the delete affects nothing.
// The check below is NOT the security boundary -- the policy is -- it exists so
// the operator gets a sentence explaining why rather than a silent no-op that
// looks like a broken button.
//
// This is the one destructive action on inbound data, and 0040 spent real effort
// making it impossible, so it stays narrow on purpose: what is deletable here is
// what never reached a client, which is what an automated test row always is.
export async function deleteRequest(
  _previous: { ok: boolean; error?: string } | null,
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing request." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to delete a request." };

  // Read first, so an assigned row can be refused by name. Read through RLS, so
  // another operator's row is simply not found.
  const { data: request } = await supabase
    .from("client_requests")
    .select("id, client_id")
    .eq("id", id)
    .maybeSingle();
  if (!request) return { ok: false, error: "That request no longer exists." };
  if (request.client_id) {
    return {
      ok: false,
      error:
        "This request is assigned to a client, so it is kept as a record of what they asked for. Mark it done instead.",
    };
  }

  const { error } = await supabase
    .from("client_requests")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: "Could not delete the request." };

  revalidatePath("/requests");
  // The home grid's unassigned strip counts these.
  revalidatePath("/home");
  return { ok: true };
}

// Delete several unassigned requests in one go.
//
// TAKES EXPLICIT IDS rather than re-deriving the set from a filter. The button
// sits under a list the operator is looking at, and the promise it makes is
// "these ones". Re-running the query server-side could quietly include a row
// that arrived between the page rendering and the button being pressed, which is
// the one thing a bulk delete must not do.
//
// The `client_id is null` filter is belt and braces: RLS
// (client_requests_operator_delete, 0087) is the boundary and already refuses an
// assigned row. Repeating it here means the count we report back cannot claim
// more than the policy would allow.
//
// Reports what actually went, not what was asked for. A short count means the
// policy refused something, and the operator should see that rather than be told
// everything worked.
export async function deleteUnassignedRequests(
  ids: string[]
): Promise<{ ok: boolean; deleted: number; error?: string }> {
  if (ids.length === 0) return { ok: true, deleted: 0 };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, deleted: 0, error: "Sign in to delete." };

  const { data, error } = await supabase
    .from("client_requests")
    .delete()
    .in("id", ids)
    .is("client_id", null)
    .select("id");
  if (error) {
    return { ok: false, deleted: 0, error: "Could not delete the requests." };
  }

  revalidatePath("/requests");
  revalidatePath("/home");
  return { ok: true, deleted: data?.length ?? 0 };
}
