"use server";

import { redirect } from "next/navigation";
import {
  formStateFromError,
  GONE_MESSAGE,
  type FormState,
} from "@/lib/form-state";
import {
  convertLeadToCustomer,
  createLead,
  restoreLead,
  softDeleteLead,
  updateLead,
} from "./actions";

// Form-facing wrappers around the leads actions: same gates, same
// validation, but denials and bad input come back as form state for
// useActionState instead of throwing at the form.

function leadInputFromForm(formData: FormData) {
  const input: Record<string, unknown> = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    message: String(formData.get("message") ?? ""),
    source: String(formData.get("source") ?? ""),
  };
  if (formData.has("status")) {
    input.status = String(formData.get("status"));
  }
  return input;
}

export async function createLeadFormAction(
  orgSlug: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  let lead: { id: string };
  try {
    lead = (await createLead(orgSlug, leadInputFromForm(formData))) as {
      id: string;
    };
  } catch (error) {
    return formStateFromError(error);
  }
  redirect(`/app/${orgSlug}/leads/${lead.id}`);
}

export async function updateLeadFormAction(
  orgSlug: string,
  leadId: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  let updated: { id: string } | null;
  try {
    updated = (await updateLead(orgSlug, {
      id: leadId,
      ...leadInputFromForm(formData),
    })) as { id: string } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!updated) {
    return { formError: GONE_MESSAGE };
  }
  redirect(`/app/${orgSlug}/leads/${leadId}`);
}

export async function softDeleteLeadFormAction(
  orgSlug: string,
  leadId: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  let deleted: { id: string } | null;
  try {
    deleted = (await softDeleteLead(orgSlug, { id: leadId })) as {
      id: string;
    } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!deleted) {
    return { formError: GONE_MESSAGE };
  }
  redirect(`/app/${orgSlug}/leads`);
}

export async function convertLeadFormAction(
  orgSlug: string,
  leadId: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  let result: { customerId: string } | { alreadyConverted: true } | null;
  try {
    result = (await convertLeadToCustomer(orgSlug, { id: leadId })) as
      | { customerId: string }
      | { alreadyConverted: true }
      | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!result) {
    return { formError: GONE_MESSAGE };
  }
  if ("alreadyConverted" in result) {
    return { formError: "This lead has already been converted." };
  }
  redirect(`/app/${orgSlug}/customers/${result.customerId}`);
}

export async function restoreLeadFormAction(
  orgSlug: string,
  leadId: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  let restored: { id: string } | null;
  try {
    restored = (await restoreLead(orgSlug, { id: leadId })) as {
      id: string;
    } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!restored) {
    return { formError: GONE_MESSAGE };
  }
  redirect(`/app/${orgSlug}/leads/deleted`);
}
