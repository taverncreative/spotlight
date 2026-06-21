"use server";

import { redirect } from "next/navigation";
import {
  formStateFromError,
  goneMessage,
  type FormState,
} from "@/lib/form-state";
import { createContact, deleteContact, updateContact } from "./actions";

// Form-facing wrappers around the contacts actions, following the established
// form pattern: denials and bad input come back as form state for
// useActionState, a null result becomes a calm gone message, and redirect()
// is called outside the try so it is never swallowed. Every contact lives on a
// customer's detail page, so a write returns there (which re-renders the
// section in display mode).

const GONE = goneMessage("contact");
const detailPath = (orgSlug: string, customerId: string) =>
  `/app/${orgSlug}/customers/${customerId}`;

function contactFieldsFromForm(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    job_title: String(formData.get("job_title") ?? ""),
  };
}

export async function createContactFormAction(
  orgSlug: string,
  customerId: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  let created: { id: string } | null;
  try {
    created = (await createContact(orgSlug, {
      customer_id: customerId,
      ...contactFieldsFromForm(formData),
    })) as { id: string } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!created) {
    return { formError: GONE };
  }
  redirect(detailPath(orgSlug, customerId));
}

export async function updateContactFormAction(
  orgSlug: string,
  customerId: string,
  contactId: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  let updated: { id: string } | null;
  try {
    updated = (await updateContact(orgSlug, {
      id: contactId,
      ...contactFieldsFromForm(formData),
    })) as { id: string } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!updated) {
    return { formError: GONE };
  }
  redirect(detailPath(orgSlug, customerId));
}

export async function setContactPrimaryFormAction(
  orgSlug: string,
  customerId: string,
  contactId: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  let updated: { id: string } | null;
  try {
    updated = (await updateContact(orgSlug, {
      id: contactId,
      is_primary: true,
    })) as { id: string } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!updated) {
    return { formError: GONE };
  }
  redirect(detailPath(orgSlug, customerId));
}

export async function deleteContactFormAction(
  orgSlug: string,
  customerId: string,
  contactId: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  let deleted: { id: string } | null;
  try {
    deleted = (await deleteContact(orgSlug, { id: contactId })) as {
      id: string;
    } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!deleted) {
    return { formError: GONE };
  }
  redirect(detailPath(orgSlug, customerId));
}
