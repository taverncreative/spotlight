"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/clients/schemas";
import { generateSecret } from "@/lib/inbound/sources";

// Inbound-source secret management, mirroring lib/content-api/actions.ts. Writes
// go through the operator SSR client, so RLS (inbound_sources_operator_all)
// enforces that the operator only ever touches their own rows -- no service role
// anywhere. Only the sha256 hash is stored; the plaintext is returned once.
//
// These rows authenticate a PUBLIC write endpoint: a row here is permission to
// POST into the triage list. That is why each action re-checks getUser() itself
// rather than trusting the settings layout's gate -- a server action is a public
// POST endpoint in its own right, and the layout does not stand in front of it.
//
// The content-API actions get their auth and their scope together from
// requireClient(clientSlug). There is no client here (a source app like gem-crm
// is not tied to one), so the check is an explicit getUser() and the scope comes
// from operator_id + RLS.

export type GenerateSourceResult =
  | { ok: true; secret: string; secretPrefix: string; sourceApp: string }
  | { ok: false; error: string };

export async function generateInboundSource(
  sourceApp: string,
  label: string
): Promise<GenerateSourceResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to manage inbound sources." };

  // Normalise before storing, reusing the client slug rule rather than inventing
  // a second one: "GEM CRM", "gem_crm" and "GEM.CRM" all land on gem-crm, so a
  // typo cannot fragment one sender into two silently distinct source_apps and
  // split the (source_app, request_id) idempotency scope.
  //
  // Deliberately no uniqueness check: 0043 allows several live rows per
  // source_app so a secret can be rotated with an overlap window (issue the new
  // one, let the sender cut over, then revoke the old), and normalisation
  // already removes the typo-fragmentation a check would have been for.
  const normalised = slugify(sourceApp);
  if (!normalised) {
    return { ok: false, error: "Enter a source name, for example gem-crm." };
  }
  if (normalised.length > 64) {
    return {
      ok: false,
      error: "That source name is too long (64 characters max).",
    };
  }

  const { secret, secretPrefix, secretHashHex } = generateSecret();

  const { error } = await supabase.from("inbound_sources").insert({
    // Set explicitly: unlike clients.operator_id this column has no auth.uid()
    // default. RLS's with_check still rejects a row written for anyone else, so
    // this satisfies NOT NULL rather than being the thing that enforces scope.
    operator_id: user.id,
    source_app: normalised,
    // bytea over PostgREST is \x-prefixed hex, as in lib/content-api/actions.ts.
    secret_hash: `\\x${secretHashHex}`,
    secret_prefix: secretPrefix,
    // Trimmed to the column's cap so a long label cannot trip the check
    // constraint and surface as an opaque failure.
    label: label.trim().slice(0, 200) || null,
  });
  if (error) return { ok: false, error: "Could not create the source." };

  revalidatePath("/settings/integrations");
  // The plaintext goes back exactly once, alongside the normalised name so the
  // operator can see what was actually stored. Nothing can recover it after this.
  return { ok: true, secret, secretPrefix, sourceApp: normalised };
}

export type RevokeSourceResult = { ok: boolean; error?: string };

export async function revokeInboundSource(
  sourceId: string
): Promise<RevokeSourceResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to manage inbound sources." };

  // No operator filter needed: RLS's using clause already limits the update to
  // the operator's own rows, so a foreign id simply matches nothing.
  const { error } = await supabase
    .from("inbound_sources")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", sourceId);
  if (error) return { ok: false, error: "Could not revoke the source." };

  revalidatePath("/settings/integrations");
  return { ok: true };
}
