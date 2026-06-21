"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  formStateFromError,
  goneMessage,
  type FormState,
} from "@/lib/form-state";
import { poundsToPence } from "@/lib/currency";
import {
  createSavingsItem,
  deleteSavingsItem,
  updateSavingsItem,
} from "./actions";

// Form-facing wrappers around the savings actions: same gates, same validation,
// but denials and bad input come back as form state for useActionState instead
// of throwing at the form. Create and edit redirect to the list; delete
// revalidates the list in place. The amount is entered in pounds and stored as
// pence, so it is converted here (string maths, never floats); a malformed
// amount is a calm field error keyed to the form's amount field, before the
// action is called.

const SAVINGS_GONE = goneMessage("savings item");
const AMOUNT_ERROR = "Enter an amount in pounds, for example 9.99";

type ParsedFields =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; state: NonNullable<FormState> };

function savingsFieldsFromForm(formData: FormData): ParsedFields {
  const amountPence = poundsToPence(String(formData.get("amount") ?? ""));
  if (amountPence === null) {
    return { ok: false, state: { fieldErrors: { amount: [AMOUNT_ERROR] } } };
  }
  return {
    ok: true,
    fields: {
      label: String(formData.get("label") ?? ""),
      amount_pence: amountPence,
      cadence: String(formData.get("cadence") ?? ""),
      note: String(formData.get("note") ?? ""),
      cancelled_on: String(formData.get("cancelled_on") ?? ""),
    },
  };
}

export async function createSavingsItemFormAction(
  orgSlug: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = savingsFieldsFromForm(formData);
  if (!parsed.ok) return parsed.state;
  try {
    const created = await createSavingsItem(orgSlug, parsed.fields);
    if (!created) return { formError: SAVINGS_GONE };
  } catch (error) {
    return formStateFromError(error);
  }
  redirect(`/app/${orgSlug}/savings`);
}

export async function updateSavingsItemFormAction(
  orgSlug: string,
  savingsItemId: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = savingsFieldsFromForm(formData);
  if (!parsed.ok) return parsed.state;
  let updated: unknown;
  try {
    updated = await updateSavingsItem(orgSlug, {
      id: savingsItemId,
      ...parsed.fields,
    });
  } catch (error) {
    return formStateFromError(error);
  }
  if (!updated) return { formError: SAVINGS_GONE };
  redirect(`/app/${orgSlug}/savings`);
}

export async function deleteSavingsItemFormAction(
  orgSlug: string,
  savingsItemId: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  try {
    const deleted = await deleteSavingsItem(orgSlug, { id: savingsItemId });
    if (!deleted) return { formError: SAVINGS_GONE };
  } catch (error) {
    return formStateFromError(error);
  }
  revalidatePath(`/app/${orgSlug}/savings`);
  return null;
}
