"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  clientFormSchema,
  fieldErrorsFromZod,
  type ClientFormState,
} from "@/lib/clients/schemas";
import { encryptToken } from "@/lib/oauth/encryption";

function parseForm(formData: FormData) {
  return clientFormSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    status: formData.get("status"),
    blog_base_url: String(formData.get("blog_base_url") ?? ""),
    deploy_hook_url: String(formData.get("deploy_hook_url") ?? ""),
    deploy_hook_remove: formData.get("deploy_hook_remove") === "on",
  });
}

// The deploy hook is stored encrypted (AES-256-GCM, see migration 0060), so the
// saved value is never rendered back into the form. That makes a blank field
// ambiguous, and the three cases have to be kept apart:
//
//   remove ticked  -> null, clear the saved hook
//   value present  -> the new ciphertext, replacing whatever was there
//   blank          -> undefined, meaning "leave the column alone"
//
// undefined is the important one: it is omitted from the update object entirely,
// so an ordinary name or status edit cannot wipe a hook the operator never saw.
// On insert there is nothing to preserve, so blank simply becomes null.
function deployHookValue(
  url: string,
  remove: boolean
): string | null | undefined {
  if (remove) return null;
  if (url) return encryptToken(url);
  return undefined;
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

  // encryptToken throws when SPOTLIGHT_TOKEN_KEY is missing or the wrong length.
  // Catch it here so a misconfigured environment reads as a form error rather
  // than a crashed action, and never echo the message (it is about the key).
  let deployHook: string | null | undefined;
  try {
    deployHook = deployHookValue(parsed.data.deploy_hook_url, false);
  } catch {
    return { ok: false, error: "Could not encrypt the deploy hook." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("clients").insert({
    name: parsed.data.name,
    slug: parsed.data.slug,
    status: parsed.data.status,
    // Blank means "we do not know this client's blog root": store null, not "".
    blog_base_url: parsed.data.blog_base_url || null,
    // Nothing to preserve on insert, so a blank field is simply no hook.
    deploy_hook_url: deployHook ?? null,
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

  let deployHook: string | null | undefined;
  try {
    deployHook = deployHookValue(
      parsed.data.deploy_hook_url,
      parsed.data.deploy_hook_remove
    );
  } catch {
    return { ok: false, error: "Could not encrypt the deploy hook." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("clients")
    .update({
      name: parsed.data.name,
      slug: parsed.data.slug,
      status: parsed.data.status,
      blog_base_url: parsed.data.blog_base_url || null,
      // Spread, not a plain key: undefined means "left blank, keep the saved
      // hook", and the column has to be absent from the payload for that.
      ...(deployHook === undefined ? {} : { deploy_hook_url: deployHook }),
    })
    .eq("id", id);

  if (error) {
    if (error.code === "23505") return SLUG_TAKEN;
    return { ok: false, error: "Could not update the client." };
  }

  revalidatePath("/home");
  return { ok: true };
}
