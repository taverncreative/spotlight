"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { QUOTE_TRANSITIONS } from "@/lib/quotes/transitions";
import { commitQuoteTransition } from "@/lib/quotes/transition";
import type { FormState } from "@/lib/form-state";

// Public accept and decline. No session exists here: the token is the only
// key, the read and write go through the service role scoped by it, and the
// move still flows through the transition map with the status-guarded
// update, so a race against an in-app transition cannot double-apply. The
// audit row records a null actor with source public_link.
export async function publicTransitionFormAction(
  token: string,
  to: "accepted" | "declined",
  _previous: FormState,
  _formData: FormData
): Promise<FormState> {
  if (!QUOTE_TRANSITIONS.sent.includes(to)) {
    return { formError: "This quote can no longer be changed." };
  }

  const admin = createAdminClient();
  const { data: quote } = await admin
    .from("quotes")
    .select("id, organisation_id, status, valid_until")
    .eq("public_token", token)
    .is("deleted_at", null)
    .maybeSingle();

  if (!quote || quote.status !== "sent") {
    // Resolved or gone; re-render shows the current state.
    redirect(`/q/${token}`);
  }

  if (
    to === "accepted" &&
    quote.valid_until &&
    quote.valid_until < new Date().toISOString().slice(0, 10)
  ) {
    return {
      formError: "This quote has expired and can no longer be accepted.",
    };
  }

  // The status-guarded update, the audit and the quote-lifecycle automation fire
  // happen at the single shared commit point, the same one the in-app transition
  // uses, so the customer accepting or declining fires the automation once.
  await commitQuoteTransition(admin, {
    organisationId: quote.organisation_id,
    quoteId: quote.id,
    from: "sent",
    to,
    changes: { status: to },
    auditActorUserId: null,
    auditSource: "public_link",
    selectColumns: "id",
  });

  redirect(`/q/${token}`);
}
