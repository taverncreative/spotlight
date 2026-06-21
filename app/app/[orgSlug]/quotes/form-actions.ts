"use server";

import { redirect } from "next/navigation";
import { poundsToPence } from "@/lib/currency";
import {
  formStateFromError,
  goneMessage,
  type FormState,
} from "@/lib/form-state";
import {
  addLineItem,
  createQuote,
  removeLineItem,
  restoreQuote,
  softDeleteQuote,
  transitionQuoteStatus,
  updateLineItem,
  updateQuote,
} from "./actions";

// Form-facing wrappers for the quote builder. Every successful operation
// redirects back to the builder, so the page re-renders with the database
// totals; no money is ever computed in the browser.

function builderPath(orgSlug: string, quoteId: string) {
  return `/app/${orgSlug}/quotes/${quoteId}/edit`;
}

export async function createQuoteFormAction(
  orgSlug: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  let quote: { id: string } | null;
  try {
    quote = (await createQuote(orgSlug, {
      customer_id: String(formData.get("customer_id") ?? ""),
      title: String(formData.get("title") ?? ""),
      valid_until: String(formData.get("valid_until") ?? ""),
    })) as { id: string } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!quote) {
    return { formError: goneMessage("customer") };
  }
  redirect(builderPath(orgSlug, quote.id));
}

export async function updateQuoteFormAction(
  orgSlug: string,
  quoteId: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  let updated: { id: string } | null;
  try {
    updated = (await updateQuote(orgSlug, {
      id: quoteId,
      customer_id: String(formData.get("customer_id") ?? ""),
      title: String(formData.get("title") ?? ""),
      valid_until: String(formData.get("valid_until") ?? ""),
      site_id: String(formData.get("site_id") ?? ""),
    })) as { id: string } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!updated) {
    return { formError: goneMessage("quote") };
  }
  redirect(builderPath(orgSlug, quoteId));
}

export async function softDeleteQuoteFormAction(
  orgSlug: string,
  quoteId: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  let deleted: { id: string } | null;
  try {
    deleted = (await softDeleteQuote(orgSlug, { id: quoteId })) as {
      id: string;
    } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!deleted) {
    return { formError: goneMessage("quote") };
  }
  redirect(`/app/${orgSlug}/quotes`);
}

export async function restoreQuoteFormAction(
  orgSlug: string,
  quoteId: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  let restored: { id: string } | null;
  try {
    restored = (await restoreQuote(orgSlug, { id: quoteId })) as {
      id: string;
    } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!restored) {
    return { formError: goneMessage("quote") };
  }
  redirect(`/app/${orgSlug}/quotes/deleted`);
}

export async function transitionQuoteFormAction(
  orgSlug: string,
  quoteId: string,
  to: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  let result:
    | { invalid: true; from: string; to: string }
    | { id: string }
    | null;
  try {
    result = (await transitionQuoteStatus(orgSlug, {
      id: quoteId,
      to,
    })) as { invalid: true; from: string; to: string } | { id: string } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!result) {
    return { formError: goneMessage("quote") };
  }
  if ("invalid" in result) {
    return {
      formError: `This quote cannot move from ${result.from} to ${result.to}.`,
    };
  }
  redirect(`/app/${orgSlug}/quotes/${quoteId}`);
}

// Reads the shared line fields from a builder form, converting the pounds
// input to integer pence server-side. Returns field errors for bad money or
// quantity input.
function lineFieldsFromForm(formData: FormData):
  | {
      fields: {
        description: string;
        quantity: number;
        unit_price_pence: number;
        vat_rate: number;
      };
    }
  | { fieldErrors: Record<string, string[]> } {
  const pence = poundsToPence(String(formData.get("unit_price_pounds") ?? ""));
  if (pence === null) {
    return {
      fieldErrors: {
        unit_price_pounds: ["Enter a price in pounds, like 149.50"],
      },
    };
  }
  const quantity = Number(formData.get("quantity") ?? "");
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { fieldErrors: { quantity: ["Enter a quantity above zero"] } };
  }
  const vatRate = Number(formData.get("vat_rate") ?? "");
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
    return { fieldErrors: { vat_rate: ["Enter a VAT rate from 0 to 100"] } };
  }
  return {
    fields: {
      description: String(formData.get("description") ?? ""),
      quantity,
      unit_price_pence: pence,
      vat_rate: vatRate,
    },
  };
}

export async function addLineItemFormAction(
  orgSlug: string,
  quoteId: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = lineFieldsFromForm(formData);
  if ("fieldErrors" in parsed) {
    return { fieldErrors: parsed.fieldErrors };
  }

  let line: { id: string } | null;
  try {
    line = (await addLineItem(orgSlug, {
      quote_id: quoteId,
      ...parsed.fields,
    })) as { id: string } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!line) {
    return { formError: goneMessage("quote") };
  }
  redirect(builderPath(orgSlug, quoteId));
}

export async function updateLineItemFormAction(
  orgSlug: string,
  quoteId: string,
  lineId: string,
  _previous: FormState,
  formData: FormData
): Promise<FormState> {
  const parsed = lineFieldsFromForm(formData);
  if ("fieldErrors" in parsed) {
    return { fieldErrors: parsed.fieldErrors };
  }

  let line: { id: string } | null;
  try {
    line = (await updateLineItem(orgSlug, {
      id: lineId,
      ...parsed.fields,
    })) as { id: string } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!line) {
    return { formError: goneMessage("line") };
  }
  redirect(builderPath(orgSlug, quoteId));
}

export async function removeLineItemFormAction(
  orgSlug: string,
  quoteId: string,
  lineId: string,
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  let removed: { id: string } | null;
  try {
    removed = (await removeLineItem(orgSlug, { id: lineId })) as {
      id: string;
    } | null;
  } catch (error) {
    return formStateFromError(error);
  }
  if (!removed) {
    return { formError: goneMessage("line") };
  }
  redirect(builderPath(orgSlug, quoteId));
}
