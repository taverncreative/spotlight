"use server";

import { createClient } from "@/lib/supabase/server";
import {
  taskFormSchema,
  fieldErrorsFromZod,
  type TaskFormState,
} from "@/lib/tasks/schemas";
import { nextDueDate } from "@/lib/tasks/recurrence";

// All actions run under RLS: the client_tasks policy (0050) allows writes only
// when owns_client(client_id) is true, so a task can never be created under, or
// moved to, a client the operator does not own, and a foreign id simply matches
// nothing. getUser() is still explicit — a server action is its own public POST
// endpoint, not standing behind the layout's auth gate.

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function parseForm(formData: FormData) {
  return taskFormSchema.safeParse({
    title: String(formData.get("title") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    due_date: String(formData.get("due_date") ?? ""),
    recurrence: String(formData.get("recurrence") ?? "none"),
  });
}

export async function createTask(
  _previous: TaskFormState,
  formData: FormData
): Promise<TaskFormState> {
  const clientId = String(formData.get("client_id") ?? "");
  if (!clientId) return { ok: false, error: "Missing client." };

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.from("client_tasks").insert({
    client_id: clientId,
    title: parsed.data.title,
    notes: parsed.data.notes || null,
    due_date: parsed.data.due_date || null,
    recurrence: parsed.data.recurrence,
  });
  if (error) return { ok: false, error: "Could not add the task." };

  return { ok: true };
}

export async function updateTask(
  _previous: TaskFormState,
  formData: FormData
): Promise<TaskFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing task id." };

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("client_tasks")
    .update({
      title: parsed.data.title,
      notes: parsed.data.notes || null,
      due_date: parsed.data.due_date || null,
      recurrence: parsed.data.recurrence,
    })
    .eq("id", id);
  if (error) return { ok: false, error: "Could not update the task." };

  return { ok: true };
}

// Completing a 'none' task marks it done. Completing a recurring task rolls its
// due_date forward by the interval and leaves it open, so the row always shows
// the next occurrence. The current due_date is read from the row rather than
// trusted from the client, so the roll is anchored on the stored cadence.
export async function completeTask(
  _previous: TaskFormState,
  formData: FormData
): Promise<TaskFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing task id." };

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: task } = await supabase
    .from("client_tasks")
    .select("recurrence, due_date")
    .eq("id", id)
    .maybeSingle();
  if (!task) return { ok: false, error: "Task not found." };

  if (task.recurrence === "none" || !task.due_date) {
    const { error } = await supabase
      .from("client_tasks")
      .update({ status: "done" })
      .eq("id", id);
    if (error) return { ok: false, error: "Could not complete the task." };
  } else {
    const { error } = await supabase
      .from("client_tasks")
      .update({ due_date: nextDueDate(task.due_date, task.recurrence) })
      .eq("id", id);
    if (error) return { ok: false, error: "Could not roll the task forward." };
  }

  return { ok: true };
}

export async function deleteTask(
  _previous: TaskFormState,
  formData: FormData
): Promise<TaskFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing task id." };

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.from("client_tasks").delete().eq("id", id);
  if (error) return { ok: false, error: "Could not delete the task." };

  return { ok: true };
}
