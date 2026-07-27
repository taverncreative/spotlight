"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Fulfilment status moves for the print orders queue.
//
// A plain form action, mirroring updateRequestStatus on the requests inbox: it
// surfaces no result, it just moves the row and revalidates the list.
//
// RLS (print_orders_operator_update, 0058) scopes every write to the operator's
// own rows, so a foreign id simply matches nothing. getUser() is still explicit
// rather than trusted from the layout: a server action is a public POST endpoint
// in its own right, and the layout's gate does not stand in front of it.

// Not exported: a "use server" module may only export async functions, so a
// const array here is a runtime error the typechecker does not catch. Nothing
// outside needs it, and if something ever does it belongs in a plain module.
const PRINT_ORDER_STATUSES = ["new", "printing", "done"] as const;
type PrintOrderStatus = (typeof PRINT_ORDER_STATUSES)[number];

export async function updatePrintOrderStatus(
  formData: FormData
): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  // Validate against the set rather than passing the field through: the column's
  // check constraint would reject anything else anyway, but that would surface
  // as an opaque failure instead of a no-op.
  if (!id || !PRINT_ORDER_STATUSES.includes(status as PrintOrderStatus)) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("print_orders").update({ status }).eq("id", id);
  revalidatePath("/print-orders");
}

// Attach an unassigned print order to a client. Same reasoning as
// assignRequestToClient: the client is read through RLS first, so a crafted id
// cannot file an order under another operator's client. RLS on print_orders
// governs which order may be written, not which client_id goes into it.
export async function assignPrintOrderToClient(
  formData: FormData
): Promise<void> {
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
    .from("print_orders")
    .update({ client_id: clientId })
    .eq("id", id);

  revalidatePath("/print-orders");
  revalidatePath("/home");
}
