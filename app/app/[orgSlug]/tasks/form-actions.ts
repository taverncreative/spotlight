"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  formStateFromError,
  goneMessage,
  type FormState,
} from "@/lib/form-state";
import { createTask, deleteTask, setTaskStatus, updateTask } from "./actions";
import type { RELATED_TYPES } from "@/lib/tasks/schemas";

// Form-facing wrappers around the tasks actions: same gates, same validation,
// but denials and bad input come back as form state for useActionState instead
// of throwing at the form. Create and edit redirect to the list; the inline
// status and delete controls revalidate the list in place so the active
// filters survive.

const TASK_GONE = goneMessage("task");

// A date input gives YYYY-MM-DD; the schema wants an ISO datetime. Empty stays
// empty (the schema turns it into null). Treat the chosen day as UTC midnight.
function dueAtFromForm(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T00:00:00.000Z`
    : trimmed;
}

function taskFieldsFromForm(formData: FormData) {
  return {
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    due_at: dueAtFromForm(String(formData.get("due_at") ?? "")),
    assigned_to: String(formData.get("assigned_to") ?? ""),
  };
}

export async function createTaskFormAction(
  orgSlug: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    const input: Record<string, unknown> = taskFieldsFromForm(formData);
    if (formData.has("status")) input.status = String(formData.get("status"));
    const created = await createTask(orgSlug, input);
    if (!created) return { formError: TASK_GONE };
  } catch (error) {
    return formStateFromError(error);
  }
  redirect(`/app/${orgSlug}/tasks`);
}

export async function updateTaskFormAction(
  orgSlug: string,
  taskId: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  let updated: unknown;
  try {
    updated = await updateTask(orgSlug, { id: taskId, ...taskFieldsFromForm(formData) });
  } catch (error) {
    return formStateFromError(error);
  }
  if (!updated) return { formError: TASK_GONE };
  redirect(`/app/${orgSlug}/tasks`);
}

export async function setTaskStatusFormAction(
  orgSlug: string,
  taskId: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    const updated = await setTaskStatus(orgSlug, {
      id: taskId,
      status: String(formData.get("status") ?? ""),
    });
    if (!updated) return { formError: TASK_GONE };
  } catch (error) {
    return formStateFromError(error);
  }
  revalidatePath(`/app/${orgSlug}/tasks`);
  return null;
}

export async function deleteTaskFormAction(
  orgSlug: string,
  taskId: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  try {
    const deleted = await deleteTask(orgSlug, { id: taskId });
    if (!deleted) return { formError: TASK_GONE };
  } catch (error) {
    return formStateFromError(error);
  }
  revalidatePath(`/app/${orgSlug}/tasks`);
  return null;
}

// The per-record TasksSection variants (Pass 6D). They are the same actions,
// but a task added from a record is linked to it by binding related_type and
// related_id server-side (never chosen in the form), and create and edit
// redirect back to that record's page while status and delete revalidate it in
// place, so the section refreshes without leaving the record.

export async function createLinkedTaskFormAction(
  orgSlug: string,
  relatedType: (typeof RELATED_TYPES)[number],
  relatedId: string,
  detailHref: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    const created = await createTask(orgSlug, {
      ...taskFieldsFromForm(formData),
      related_type: relatedType,
      related_id: relatedId,
    });
    if (!created) return { formError: TASK_GONE };
  } catch (error) {
    return formStateFromError(error);
  }
  redirect(detailHref);
}

export async function updateLinkedTaskFormAction(
  orgSlug: string,
  taskId: string,
  detailHref: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  let updated: unknown;
  try {
    updated = await updateTask(orgSlug, {
      id: taskId,
      ...taskFieldsFromForm(formData),
    });
  } catch (error) {
    return formStateFromError(error);
  }
  if (!updated) return { formError: TASK_GONE };
  redirect(detailHref);
}

export async function setLinkedTaskStatusFormAction(
  orgSlug: string,
  taskId: string,
  detailHref: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    const updated = await setTaskStatus(orgSlug, {
      id: taskId,
      status: String(formData.get("status") ?? ""),
    });
    if (!updated) return { formError: TASK_GONE };
  } catch (error) {
    return formStateFromError(error);
  }
  revalidatePath(detailHref);
  return null;
}

export async function deleteLinkedTaskFormAction(
  orgSlug: string,
  taskId: string,
  detailHref: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  try {
    const deleted = await deleteTask(orgSlug, { id: taskId });
    if (!deleted) return { formError: TASK_GONE };
  } catch (error) {
    return formStateFromError(error);
  }
  revalidatePath(detailHref);
  return null;
}
