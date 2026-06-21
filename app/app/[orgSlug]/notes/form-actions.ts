"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  formStateFromError,
  goneMessage,
  type FormState,
} from "@/lib/form-state";
import { createNote, deleteNote, updateNote } from "./actions";
import type { RELATED_TYPES } from "@/lib/notes/schemas";

// Form-facing wrappers around the notes actions for the per-record NotesSection
// (Pass 7B), mirroring the linked task form-actions. A note added from a record
// is linked to it by binding related_type and related_id server-side (never
// chosen in the form), so the link cannot be forged from the client. Create and
// edit redirect back to the record; delete revalidates it in place.

const NOTE_GONE = goneMessage("note");

function bodyFromForm(formData: FormData) {
  return String(formData.get("body") ?? "");
}

export async function createLinkedNoteFormAction(
  orgSlug: string,
  relatedType: (typeof RELATED_TYPES)[number],
  relatedId: string,
  detailHref: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    const created = await createNote(orgSlug, {
      body: bodyFromForm(formData),
      related_type: relatedType,
      related_id: relatedId,
    });
    if (!created) return { formError: NOTE_GONE };
  } catch (error) {
    return formStateFromError(error);
  }
  redirect(detailHref);
}

export async function updateLinkedNoteFormAction(
  orgSlug: string,
  noteId: string,
  detailHref: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  let updated: unknown;
  try {
    updated = await updateNote(orgSlug, {
      id: noteId,
      body: bodyFromForm(formData),
    });
  } catch (error) {
    return formStateFromError(error);
  }
  if (!updated) return { formError: NOTE_GONE };
  redirect(detailHref);
}

export async function deleteLinkedNoteFormAction(
  orgSlug: string,
  noteId: string,
  detailHref: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  try {
    const deleted = await deleteNote(orgSlug, { id: noteId });
    if (!deleted) return { formError: NOTE_GONE };
  } catch (error) {
    return formStateFromError(error);
  }
  revalidatePath(detailHref);
  return null;
}
