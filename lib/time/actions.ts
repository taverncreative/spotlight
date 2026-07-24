"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  allocationFormSchema,
  fieldErrorsFromZod,
  type AllocationFormState,
} from "@/lib/time/schemas";

// Runs under RLS: clients_operator_all (0003) allows an update only on the
// operator's own clients, so a foreign id simply matches nothing. getUser() is
// still explicit — a server action is its own public POST endpoint, not standing
// behind the layout's auth gate.
async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// Set (or clear) a client's monthly retainer allocation. Hours in, integer
// minutes stored; an empty value clears back to null ("not set").
export async function setAllocation(
  _previous: AllocationFormState,
  formData: FormData
): Promise<AllocationFormState> {
  const clientId = String(formData.get("client_id") ?? "");
  if (!clientId) return { ok: false, error: "Missing client." };

  const parsed = allocationFormSchema.safeParse({
    hours: String(formData.get("hours") ?? ""),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const retainerMinutes =
    parsed.data.hours === null ? null : Math.round(parsed.data.hours * 60);

  const { error } = await supabase
    .from("clients")
    .update({ retainer_minutes: retainerMinutes })
    .eq("id", clientId);
  if (error) return { ok: false, error: "Could not save the allocation." };

  revalidatePath("/time");
  return { ok: true };
}
