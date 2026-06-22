"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  clientFormSchema,
  fieldErrorsFromZod,
  type ClientFormState,
} from "@/lib/clients/schemas";

function parseForm(formData: FormData) {
  return clientFormSchema.safeParse({
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
  return { ok: true };
}

// Update a client. RLS limits the update to the operator's own rows.
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
