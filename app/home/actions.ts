"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  clientRosterSchema,
  fieldErrorsFromZod,
  type ClientFormState,
} from "@/lib/clients/schemas";

// Roster writes only: name, slug and status, the minimum to bring a client into
// existence. Everything else a client can be configured with now lives on their
// Settings tab and is written by lib/clients/settings-actions.ts.
//
// Splitting them matters beyond tidiness: this action no longer touches the
// deploy hook at all, so the three-way "blank means keep the encrypted value"
// dance it used to carry cannot be got wrong from here.
function parseForm(formData: FormData) {
  return clientRosterSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    status: formData.get("status"),
  });
}

// A unique-violation on (operator_id, slug) means the slug is taken; surface it
// on the slug field rather than silently suffixing.
const SLUG_TAKEN = {
  ok: false,
  fieldErrors: { slug: ["That slug is already in use. Choose another."] },
} satisfies ClientFormState;

// Create a client. operator_id defaults to auth.uid() via the column default, so
// RLS (operator_id = auth.uid()) places the row with the signed-in operator.
// Services, logo, blog URL and deploy hook all start empty and are set on the
// client's Settings tab, which needs a client that exists.
export async function createClientAction(
  _previous: ClientFormState,
  formData: FormData
): Promise<ClientFormState> {
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("clients").insert({
    name: parsed.data.name,
    slug: parsed.data.slug,
    status: parsed.data.status,
  });

  if (error) {
    if (error.code === "23505") return SLUG_TAKEN;
    return { ok: false, error: "Could not create the client." };
  }

  revalidatePath("/home");
  // Straight to the new client's settings rather than back to the grid. The
  // dialog only collects the three fields needed to exist; the decisions that
  // matter (services, logo, blog URL, deploy hook) are all on the next page, and
  // telling someone where those live without taking them there is an instruction
  // to go and find it.
  //
  // redirect() throws, so nothing below it runs and the dialog's own
  // close-and-refresh effect never fires. That is fine: the page is replaced.
  redirect(`/c/${parsed.data.slug}/settings`);
}

// Update a client's roster details. RLS limits the update to the operator's own
// rows. Note what is NOT in the payload: nothing here can disturb the client's
// configuration, so editing a name cannot have a side effect on their services
// or their stored hook.
export async function updateClientAction(
  _previous: ClientFormState,
  formData: FormData
): Promise<ClientFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing client id." };

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("clients")
    .update({
      name: parsed.data.name,
      slug: parsed.data.slug,
      status: parsed.data.status,
    })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") return SLUG_TAKEN;
    return { ok: false, error: "Could not update the client." };
  }

  revalidatePath("/home");
  return { ok: true };
}
