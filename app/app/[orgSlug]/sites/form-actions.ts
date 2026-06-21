"use server";

import { redirect } from "next/navigation";
import {
  formStateFromError,
  goneMessage,
  type FormState,
} from "@/lib/form-state";
import {
  createSite,
  restoreSite,
  softDeleteSite,
  updateSite,
} from "./actions";

// Form-facing wrappers around the sites actions, same shape as the contacts
// wrappers. Sites live on a customer's detail page, so a write returns there.

const GONE = goneMessage("site");
const detailPath = (orgSlug: string, customerId: string) =>
  `/app/${orgSlug}/customers/${customerId}`;

function siteFieldsFromForm(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    address_line1: String(formData.get("address_line1") ?? ""),
    address_line2: String(formData.get("address_line2") ?? ""),
    town: String(formData.get("town") ?? ""),
    county: String(formData.get("county") ?? ""),
    postcode: String(formData.get("postcode") ?? ""),
    access_notes: String(formData.get("access_notes") ?? ""),
  };
}

export async function createSiteFormAction(
  orgSlug: string,
  customerId: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  let created: { id: string } | null;
  try {
    created = (await createSite(orgSlug, {
      customer_id: customerId,
      ...siteFieldsFromForm(formData),
    })) as { id: string } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!created) {
    return { formError: GONE };
  }
  redirect(detailPath(orgSlug, customerId));
}

export async function updateSiteFormAction(
  orgSlug: string,
  customerId: string,
  siteId: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  let updated: { id: string } | null;
  try {
    updated = (await updateSite(orgSlug, {
      id: siteId,
      ...siteFieldsFromForm(formData),
    })) as { id: string } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!updated) {
    return { formError: GONE };
  }
  redirect(detailPath(orgSlug, customerId));
}

export async function softDeleteSiteFormAction(
  orgSlug: string,
  customerId: string,
  siteId: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  let deleted: { id: string } | null;
  try {
    deleted = (await softDeleteSite(orgSlug, { id: siteId })) as {
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

export async function restoreSiteFormAction(
  orgSlug: string,
  customerId: string,
  siteId: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  let restored: { id: string } | null;
  try {
    restored = (await restoreSite(orgSlug, { id: siteId })) as {
      id: string;
    } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!restored) {
    return { formError: GONE };
  }
  redirect(detailPath(orgSlug, customerId));
}
