"use server";

import { redirect } from "next/navigation";
import {
  formStateFromError,
  goneMessage,
  type FormState,
} from "@/lib/form-state";
import {
  createCustomer,
  restoreCustomer,
  softDeleteCustomer,
  updateCustomer,
} from "./actions";

// Form-facing wrappers around the customers actions, following the leads
// form pattern: denials and bad input come back as form state for
// useActionState instead of throwing at the form.

function customerInputFromForm(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    type: String(formData.get("type") ?? "business"),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    address_line1: String(formData.get("address_line1") ?? ""),
    address_line2: String(formData.get("address_line2") ?? ""),
    town: String(formData.get("town") ?? ""),
    county: String(formData.get("county") ?? ""),
    postcode: String(formData.get("postcode") ?? ""),
  };
}

export async function createCustomerFormAction(
  orgSlug: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  let customer: { id: string };
  try {
    customer = (await createCustomer(
      orgSlug,
      customerInputFromForm(formData)
    )) as { id: string };
  } catch (error) {
    return formStateFromError(error);
  }
  redirect(`/app/${orgSlug}/customers/${customer.id}`);
}

export async function updateCustomerFormAction(
  orgSlug: string,
  customerId: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  let updated: { id: string } | null;
  try {
    updated = (await updateCustomer(orgSlug, {
      id: customerId,
      ...customerInputFromForm(formData),
    })) as { id: string } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!updated) {
    return { formError: goneMessage("customer") };
  }
  redirect(`/app/${orgSlug}/customers/${customerId}`);
}

export async function softDeleteCustomerFormAction(
  orgSlug: string,
  customerId: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  let deleted: { id: string } | null;
  try {
    deleted = (await softDeleteCustomer(orgSlug, { id: customerId })) as {
      id: string;
    } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!deleted) {
    return { formError: goneMessage("customer") };
  }
  redirect(`/app/${orgSlug}/customers`);
}

export async function restoreCustomerFormAction(
  orgSlug: string,
  customerId: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  let restored: { id: string } | null;
  try {
    restored = (await restoreCustomer(orgSlug, { id: customerId })) as {
      id: string;
    } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!restored) {
    return { formError: goneMessage("customer") };
  }
  redirect(`/app/${orgSlug}/customers/deleted`);
}
