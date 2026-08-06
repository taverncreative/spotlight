"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { encryptToken } from "@/lib/oauth/encryption";
import {
  clientSettingsSchema,
  fieldErrorsFromZod,
  weekdayThemesSchema,
  type ClientFormState,
} from "@/lib/clients/schemas";
import { normaliseThemes } from "@/lib/calendar/weekday-themes";

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

// The seven weekday themes, saved from the social calendar rather than the
// Settings tab.
//
// WHY NOT ON THE SETTINGS TAB, which is where every other client setting lives.
// A theme is decided while looking at the plan -- "Tuesday should be real
// weddings, and there is nothing on the next three Tuesdays" -- and that thought
// happens on the calendar, not two pages away in a form you opened to change a
// deploy hook. The Settings tab is also five sections deep already.
//
// Called directly from the client component with plain arguments, like
// setClientLogo above and for the same reason: it is one small thing saved on
// its own, not a section of a larger form.
export async function updateWeekdayThemes(
  clientId: string,
  clientSlug: string,
  themes: string[]
): Promise<{ ok: boolean; error?: string }> {
  if (!clientId) return { ok: false, error: "Missing client." };

  const parsed = weekdayThemesSchema.safeParse({
    // Normalised before validation so a short array from an older client bundle
    // is padded rather than rejected. The schema then guards the length cap,
    // which normalising does not enforce -- it truncates.
    weekday_themes: normaliseThemes(themes),
  });
  if (!parsed.success) {
    return { ok: false, error: "Those themes could not be saved." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Signed out. Sign in again." };

  const { error } = await supabase
    .from("clients")
    .update({ weekday_themes: parsed.data.weekday_themes })
    .eq("id", clientId);
  if (error) return { ok: false, error: "Could not save the themes." };

  // The social calendar is the only surface that reads them today. Named
  // explicitly rather than revalidating the client layout, so saving a theme
  // does not refetch every module page for this client.
  if (clientSlug) revalidatePath(`/c/${clientSlug}/social`);
  return { ok: true };
}

// --- archive, restore, delete ---------------------------------------------
//
// Archive is the EXISTING status field finally doing something. The column has
// carried active|paused|archived since 0008, but exactly one query in the whole
// app read it (the /time board), so archiving a client changed nothing you could
// see. It now drops them from the grid, the client selector, requireClient and
// the assign dropdowns, which is what it always meant.

export async function archiveClient(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("clients").update({ status: "archived" }).eq("id", id);
  revalidatePath("/home");
  // The client's own pages 404 from here, so there is nowhere to send them back
  // to; the grid's Archived section is the only surface that still lists them.
  redirect("/home");
}

export async function restoreClient(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("clients").update({ status: "active" }).eq("id", id);
  revalidatePath("/home");
}

// Permanent, and gated three ways.
//
// The cascade is why. Deleting a client takes their sites, posts, social posts,
// API keys, DMARC domains, tasks AND time entries with it; time_entries is
// billing history with no other record anywhere. Requests, print orders and Meta
// accounts survive but are unlinked, so inbound work reappears in the unassigned
// inbox with no client left to reassign it to.
//
// The three gates, all enforced HERE and not merely in the dialog:
//
//   1. The client must already be archived. Deletion is never one click from the
//      roster; it takes a deliberate earlier step.
//   2. The typed name must match exactly. A confirm button can be clicked
//      through; a name has to be read first.
//   3. RLS scopes the delete to the operator's own rows regardless.
export async function deleteClient(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const typedName = String(formData.get("confirm_name") ?? "").trim();
  if (!id || !typedName) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, status")
    .eq("id", id)
    .maybeSingle();
  if (!client) return;
  if (client.status !== "archived") return;
  if (typedName !== client.name) return;

  await supabase.from("clients").delete().eq("id", id);
  revalidatePath("/home");
}
