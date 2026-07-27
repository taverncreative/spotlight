"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
const REQUEST_STATUSES = ["new", "in_progress", "done"] as const;
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

  await supabase
    .from("client_requests")
    .update({ client_id: clientId })
    .eq("id", id);

  revalidatePath("/requests");
  // The home grid counts and the unassigned strip both move with this.
  revalidatePath("/home");
}
