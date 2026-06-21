"use server";

import { createClient } from "@/lib/supabase/server";
import {
  siteFormSchema,
  fieldErrorsFromZod,
  type SiteFormState,
} from "@/lib/sites/schemas";

// All three actions operate under RLS: the sites policy allows writes only when
// owns_client(client_id) is true, so a site can never be created under, or moved
// to, a client the operator does not own.

function parseForm(formData: FormData) {
  return siteFormSchema.safeParse({
    url: String(formData.get("url") ?? ""),
    label: String(formData.get("label") ?? ""),
    check_interval_minutes: formData.get("check_interval_minutes"),
    monitoring_enabled: formData.get("monitoring_enabled") === "on",
  });
}

export async function createSite(
  _previous: SiteFormState,
  formData: FormData
): Promise<SiteFormState> {
  const clientId = String(formData.get("client_id") ?? "");
  if (!clientId) return { ok: false, error: "Missing client." };

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("sites").insert({
    client_id: clientId,
    url: parsed.data.url,
    label: parsed.data.label || null,
    check_interval_minutes: parsed.data.check_interval_minutes,
    monitoring_enabled: parsed.data.monitoring_enabled,
  });
  if (error) return { ok: false, error: "Could not add the site." };

  return { ok: true };
}

export async function updateSite(
  _previous: SiteFormState,
  formData: FormData
): Promise<SiteFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing site id." };

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("sites")
    .update({
      url: parsed.data.url,
      label: parsed.data.label || null,
      check_interval_minutes: parsed.data.check_interval_minutes,
      monitoring_enabled: parsed.data.monitoring_enabled,
    })
    .eq("id", id);
  if (error) return { ok: false, error: "Could not update the site." };

  return { ok: true };
}

export async function deleteSite(
  _previous: SiteFormState,
  formData: FormData
): Promise<SiteFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing site id." };

  const supabase = await createClient();
  const { error } = await supabase.from("sites").delete().eq("id", id);
  if (error) return { ok: false, error: "Could not remove the site." };

  return { ok: true };
}
