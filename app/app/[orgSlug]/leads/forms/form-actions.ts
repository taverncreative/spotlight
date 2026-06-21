"use server";

import { redirect } from "next/navigation";
import { formStateFromError, goneMessage, type FormState } from "@/lib/form-state";
import {
  createWebhookForm,
  regenerateWebhookFormToken,
  setWebhookFormStatus,
} from "./actions";

// Form-facing wrappers: same gates and validation as the actions, but denials
// and invalid input come back as form state for useActionState rather than
// throwing at the form. redirect() is called outside the try so it is never
// swallowed; after a write the page re-renders with the change.

const GONE = goneMessage("form");
const formsPath = (orgSlug: string) => `/app/${orgSlug}/leads/forms`;

export async function createWebhookFormFormAction(
  orgSlug: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    await createWebhookForm(orgSlug, {
      name: String(formData.get("name") ?? ""),
    });
  } catch (error) {
    return formStateFromError(error);
  }
  redirect(formsPath(orgSlug));
}

export async function setWebhookFormStatusFormAction(
  orgSlug: string,
  id: string,
  status: "active" | "disabled",
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  let updated: { id: string } | null;
  try {
    updated = (await setWebhookFormStatus(orgSlug, { id, status })) as {
      id: string;
    } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!updated) {
    return { formError: GONE };
  }
  redirect(formsPath(orgSlug));
}

export async function regenerateWebhookFormTokenFormAction(
  orgSlug: string,
  id: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  let updated: { id: string } | null;
  try {
    updated = (await regenerateWebhookFormToken(orgSlug, { id })) as {
      id: string;
    } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!updated) {
    return { formError: GONE };
  }
  redirect(formsPath(orgSlug));
}
