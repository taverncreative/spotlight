"use server";

import { createClient } from "@/lib/supabase/server";
import { checkSite, type CheckResult } from "@/lib/sites/checker";
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

// A per-site cap so one slow site cannot hang Check all; on cap the site records
// as down (timed out).
const TIMED_OUT: CheckResult = {
  status: "down",
  http_status: null,
  response_ms: null,
  ssl_expiry: null,
  domain_expiry: null,
};

function withCap(promise: Promise<CheckResult>, ms: number): Promise<CheckResult> {
  return Promise.race([
    promise,
    new Promise<CheckResult>((resolve) => {
      setTimeout(() => resolve(TIMED_OUT), ms);
    }),
  ]);
}

// Operator-triggered check of a single site. RLS limits the read and the
// site_checks insert to the operator's own sites (owns_site).
export async function checkNow(
  _previous: SiteFormState,
  formData: FormData
): Promise<SiteFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing site id." };

  const supabase = await createClient();
  const { data: site } = await supabase
    .from("sites")
    .select("id, url")
    .eq("id", id)
    .maybeSingle();
  if (!site) return { ok: false, error: "Site not found." };

  const result = await checkSite(site.url);
  const { error } = await supabase.from("site_checks").insert({
    site_id: site.id,
    status: result.status,
    http_status: result.http_status,
    response_ms: result.response_ms,
    ssl_expiry: result.ssl_expiry,
    domain_expiry: result.domain_expiry,
  });
  if (error) return { ok: false, error: "Could not record the check." };

  return { ok: true };
}

// Operator-triggered check of every site under a client, run concurrently with a
// per-site cap. The view refreshes once all have recorded.
export async function checkAll(
  _previous: SiteFormState,
  formData: FormData
): Promise<SiteFormState> {
  const clientId = String(formData.get("client_id") ?? "");
  if (!clientId) return { ok: false, error: "Missing client." };

  const supabase = await createClient();
  const { data: sites } = await supabase
    .from("sites")
    .select("id, url")
    .eq("client_id", clientId);
  if (!sites || sites.length === 0) return { ok: true };

  await Promise.allSettled(
    sites.map(async (site) => {
      const result = await withCap(checkSite(site.url), 15_000);
      await supabase.from("site_checks").insert({
        site_id: site.id,
        status: result.status,
        http_status: result.http_status,
        response_ms: result.response_ms,
        ssl_expiry: result.ssl_expiry,
        domain_expiry: result.domain_expiry,
      });
    })
  );

  return { ok: true };
}
