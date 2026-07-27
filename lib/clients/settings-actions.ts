"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { encryptToken } from "@/lib/oauth/encryption";
import {
  clientSettingsSchema,
  fieldErrorsFromZod,
  type ClientFormState,
} from "@/lib/clients/schemas";

// The client's own configuration, written from /c/[clientSlug]/settings.
//
// Everything here runs under RLS: clients_operator_all (0003) allows an update
// only on the operator's own rows, so a foreign id simply matches nothing.
// getUser() is still explicit, because a server action is a public POST endpoint
// in its own right and does not stand behind the layout's gate.

// The deploy hook is stored encrypted (0060), so the saved value is never
// rendered back into the form. That makes a blank field ambiguous, and the three
// cases have to be kept apart:
//
//   remove ticked  -> null, clear the saved hook
//   value present  -> the new ciphertext, replacing whatever was there
//   blank          -> undefined, meaning "leave the column alone"
//
// undefined is the important one: it is omitted from the update entirely, so
// saving the services checkboxes cannot wipe a hook the operator never saw.
function deployHookValue(
  url: string,
  remove: boolean
): string | null | undefined {
  if (remove) return null;
  if (url) return encryptToken(url);
  return undefined;
}

export async function updateClientSettings(
  _previous: ClientFormState,
  formData: FormData
): Promise<ClientFormState> {
  const id = String(formData.get("id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  if (!id) return { ok: false, error: "Missing client." };

  const parsed = clientSettingsSchema.safeParse({
    blog_base_url: String(formData.get("blog_base_url") ?? ""),
    deploy_hook_url: String(formData.get("deploy_hook_url") ?? ""),
    deploy_hook_remove: formData.get("deploy_hook_remove") === "on",
    // getAll: one checkbox per service, all sharing the name.
    services: formData.getAll("services").map(String),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Signed out. Sign in again." };

  // encryptToken throws when SPOTLIGHT_TOKEN_KEY is missing or the wrong length.
  // Caught here so a misconfigured environment reads as a form error rather than
  // a crashed action, and never echoed (the message is about the key).
  let deployHook: string | null | undefined;
  try {
    deployHook = deployHookValue(
      parsed.data.deploy_hook_url,
      parsed.data.deploy_hook_remove
    );
  } catch {
    return { ok: false, error: "Could not encrypt the deploy hook." };
  }

  const { error } = await supabase
    .from("clients")
    .update({
      blog_base_url: parsed.data.blog_base_url || null,
      services: parsed.data.services,
      // Spread, not a plain key: undefined means "left blank, keep the saved
      // hook", and the column has to be absent from the payload for that.
      ...(deployHook === undefined ? {} : { deploy_hook_url: deployHook }),
    })
    .eq("id", id);
  if (error) return { ok: false, error: "Could not save the settings." };

  if (slug) revalidatePath(`/c/${slug}/settings`);
  // Services and the logo both feed the home cards, so the grid has to catch up.
  revalidatePath("/home");
  return { ok: true };
}

// The logo saves on its own, the moment it is uploaded or removed, rather than
// waiting for the Save button below it. An upload that silently does nothing
// until you scroll down and press Save is a trap, and the file is already in
// storage by this point either way.
//
// Called directly from the client component rather than through a form, so it
// takes plain arguments instead of FormData.
export async function setClientLogo(
  clientId: string,
  logoUrl: string | null
): Promise<{ ok: boolean; error?: string }> {
  if (!clientId) return { ok: false, error: "Missing client." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Signed out. Sign in again." };

  const { error } = await supabase
    .from("clients")
    .update({ logo_url: logoUrl })
    .eq("id", clientId);
  if (error) return { ok: false, error: "Could not save the logo." };

  revalidatePath("/home");
  return { ok: true };
}
