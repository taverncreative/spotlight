"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  formStateFromError,
  goneMessage,
  type FormState,
} from "@/lib/form-state";
import { createTemplate, deleteTemplate, updateTemplate } from "./actions";

// Form-facing wrappers around the templates actions: same gates, same
// validation, but denials and bad input come back as form state for
// useActionState instead of throwing at the form. Create and edit redirect to
// the list; delete revalidates the list in place.

const TEMPLATE_GONE = goneMessage("template");

function templateFieldsFromForm(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    category: String(formData.get("category") ?? ""),
    subject: String(formData.get("subject") ?? ""),
    body: String(formData.get("body") ?? ""),
  };
}

export async function createTemplateFormAction(
  orgSlug: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    const created = await createTemplate(orgSlug, templateFieldsFromForm(formData));
    if (!created) return { formError: TEMPLATE_GONE };
  } catch (error) {
    return formStateFromError(error);
  }
  redirect(`/app/${orgSlug}/templates`);
}

export async function updateTemplateFormAction(
  orgSlug: string,
  templateId: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  let updated: unknown;
  try {
    updated = await updateTemplate(orgSlug, {
      id: templateId,
      ...templateFieldsFromForm(formData),
    });
  } catch (error) {
    return formStateFromError(error);
  }
  if (!updated) return { formError: TEMPLATE_GONE };
  redirect(`/app/${orgSlug}/templates`);
}

export async function deleteTemplateFormAction(
  orgSlug: string,
  templateId: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  try {
    const deleted = await deleteTemplate(orgSlug, { id: templateId });
    if (!deleted) return { formError: TEMPLATE_GONE };
  } catch (error) {
    return formStateFromError(error);
  }
  revalidatePath(`/app/${orgSlug}/templates`);
  return null;
}
