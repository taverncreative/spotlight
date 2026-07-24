"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  allocationFormSchema,
  fieldErrorsFromZod,
  type AllocationFormState,
  type TimerActionState,
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

// Start a stopwatch for a client: insert a running timer row (ended_at null).
// No-op if one is already running for that client, so the card never stacks two
// timers. The running check runs under RLS, so it only ever sees the operator's
// own rows; a foreign client_id matches nothing and the insert is denied.
export async function startTimer(
  _previous: TimerActionState,
  formData: FormData
): Promise<TimerActionState> {
  const clientId = String(formData.get("client_id") ?? "");
  if (!clientId) return { ok: false, error: "Missing client." };

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: running, error: checkError } = await supabase
    .from("time_entries")
    .select("id")
    .eq("client_id", clientId)
    .eq("kind", "timer")
    .is("ended_at", null)
    .limit(1);
  if (checkError) return { ok: false, error: "Could not start the timer." };
  // Already running: nothing to do, one visible stopwatch per client.
  if (running && running.length > 0) {
    revalidatePath("/time");
    return { ok: true };
  }

  const { error } = await supabase
    .from("time_entries")
    .insert({ client_id: clientId, kind: "timer" });
  if (error) return { ok: false, error: "Could not start the timer." };

  revalidatePath("/time");
  return { ok: true };
}

// Stop a client's stopwatch: set ended_at = now() on EVERY running timer row for
// the client, not just one. If a double-click or a crashed session left more than
// one running, this closes them all so no orphan row ticks forever.
export async function stopTimer(
  _previous: TimerActionState,
  formData: FormData
): Promise<TimerActionState> {
  const clientId = String(formData.get("client_id") ?? "");
  if (!clientId) return { ok: false, error: "Missing client." };

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("time_entries")
    .update({ ended_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("kind", "timer")
    .is("ended_at", null);
  if (error) return { ok: false, error: "Could not stop the timer." };

  revalidatePath("/time");
  return { ok: true };
}
