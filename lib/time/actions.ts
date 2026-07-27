"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  allocationFormSchema,
  adjustmentFormSchema,
  fieldErrorsFromZod,
  type AllocationFormState,
  type AdjustmentFormState,
  type TimerActionState,
} from "@/lib/time/schemas";

// Runs under RLS: clients_operator_all (0003) allows an update only on the
// operator's own clients, so a foreign id simply matches nothing. getUser() is
// still explicit — a server action is its own public POST endpoint, not standing
// behind the layout's auth gate.
//
// The error is CAPTURED, not discarded. getUser() always makes a live call to
// the auth server, so a network blip, a 5xx or a rate limit all come back as
// user: null with an error attached. The old code read only the user and every
// one of those surfaced to the operator as "Not signed in.", which is wrong for
// all of them and unfalsifiable for the real one. A timer that fails to start
// loses billable time, so the difference between "sign in again" and "try again"
// is the difference between acting on it and shrugging at it.
async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  return { supabase, user: data.user, authError: error };
}

// One message shape for both failure modes, so every action reports them
// identically. Returns null when the session is good.
//
// Logged with the code only, never the token or the body, matching the inbound
// endpoints' convention.
function authFailure(
  user: unknown,
  authError: { message?: string; status?: number } | null
): string | null {
  if (user) return null;
  if (authError) {
    console.error(
      "time: auth check failed",
      authError.status ?? "no-status",
      authError.message ?? "no-message"
    );
    return "Could not verify your session. Try again.";
  }
  // No user and no error is a genuine signed-out state.
  return "Signed out. Sign in again.";
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

  const { supabase, user, authError } = await requireUser();
  const failure = authFailure(user, authError);
  if (failure) return { ok: false, error: failure };

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

  const { supabase, user, authError } = await requireUser();
  const failure = authFailure(user, authError);
  if (failure) return { ok: false, error: failure };

  const { data: running, error: checkError } = await supabase
    .from("time_entries")
    .select("id, started_at")
    .eq("client_id", clientId)
    .eq("kind", "timer")
    .is("ended_at", null)
    .order("started_at", { ascending: true })
    .limit(1);
  if (checkError) return { ok: false, error: "Could not start the timer." };
  // Already running: nothing to do, one visible stopwatch per client. Hand back
  // the existing started_at so the card ticks from the truth rather than from
  // when the redundant click happened.
  if (running && running.length > 0) {
    return { ok: true, runningSince: running[0].started_at as string };
  }

  // started_at is returned rather than assumed: the column defaults to now() in
  // the database, so the server's clock is the one the card must tick from.
  const { data: inserted, error } = await supabase
    .from("time_entries")
    .insert({ client_id: clientId, kind: "timer" })
    .select("started_at")
    .single();
  if (error) return { ok: false, error: "Could not start the timer." };

  // NO revalidatePath. Starting a stopwatch changes exactly one card, and the
  // page is force-dynamic, so revalidating meant refetching every client and
  // every entry this month and re-sorting the board for a click that altered one
  // number. The card takes runningSince and ticks from it.
  return { ok: true, runningSince: inserted.started_at as string };
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

  const { supabase, user, authError } = await requireUser();
  const failure = authFailure(user, authError);
  if (failure) return { ok: false, error: failure };

  const { error } = await supabase
    .from("time_entries")
    .update({ ended_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("kind", "timer")
    .is("ended_at", null);
  if (error) return { ok: false, error: "Could not stop the timer." };

  // Stop KEEPS the revalidate, unlike start. Stopping moves the session's
  // elapsed into the settled total, which the headline bar and the card order
  // both derive from, so the page genuinely has to be rebuilt. Optimistically
  // updating that would mean recomputing settled seconds on the client, which is
  // where drift would start.
  revalidatePath("/time");
  return { ok: true, runningSince: null };
}

// A manual correction for a forgotten start/stop: a signed adjust_seconds on a
// chosen day. Add is positive, subtract negative. The day is anchored to noon UTC
// so it buckets into the month of that calendar date (matching the board); a
// future day is rejected. kind='manual', no ended_at (per the shape constraint).
export async function addAdjustment(
  _previous: AdjustmentFormState,
  formData: FormData
): Promise<AdjustmentFormState> {
  const clientId = String(formData.get("client_id") ?? "");
  if (!clientId) return { ok: false, error: "Missing client." };

  const parsed = adjustmentFormSchema.safeParse({
    direction: String(formData.get("direction") ?? "add"),
    hours: String(formData.get("hours") ?? ""),
    minutes: String(formData.get("minutes") ?? ""),
    date: String(formData.get("date") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  // No corrections dated in the future; compare calendar days in UTC, the same
  // basis the board buckets months on.
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (parsed.data.date > todayUtc) {
    return {
      ok: false,
      fieldErrors: { date: ["The date cannot be in the future."] },
    };
  }

  const { supabase, user, authError } = await requireUser();
  const failure = authFailure(user, authError);
  if (failure) return { ok: false, error: failure };

  const magnitude = parsed.data.hours * 3600 + parsed.data.minutes * 60;
  const adjustSeconds =
    parsed.data.direction === "subtract" ? -magnitude : magnitude;

  const { error } = await supabase.from("time_entries").insert({
    client_id: clientId,
    kind: "manual",
    started_at: `${parsed.data.date}T12:00:00.000Z`,
    adjust_seconds: adjustSeconds,
    note: parsed.data.note || null,
  });
  if (error) return { ok: false, error: "Could not save the adjustment." };

  revalidatePath("/time");
  return { ok: true };
}
