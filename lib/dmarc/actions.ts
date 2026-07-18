"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  buildDmarcRecord,
  buildRuaFragment,
  defaultKnownSenders,
  generateIngestAddress,
  normaliseDomain,
} from "@/lib/dmarc/setup";

// Operator-side management for the Email health view: add a monitored domain,
// and edit its known senders. Writes go through the operator SSR client, so RLS
// (dmarc_domains_operator_all on operator_id, the child policies via
// owns_dmarc_domain) scopes every write to the operator's own rows.
//
// Every action re-checks getUser() itself rather than trusting the /email
// layout's gate: a server action is a public POST endpoint in its own right, and
// the layout does not stand in front of it -- the same discipline as
// lib/inbound/actions.ts and lib/requests/actions.ts.

export type CreateDomainResult =
  | {
      ok: true;
      domain: string;
      ingestAddress: string;
      ruaFragment: string;
      fullRecord: string;
    }
  | { ok: false; error: string };

export async function createDomain(
  rawDomain: string
): Promise<CreateDomainResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to add a domain." };

  const domain = normaliseDomain(rawDomain);
  if (!domain) {
    return {
      ok: false,
      error: "Enter a valid domain, for example acme.co.uk.",
    };
  }

  // Generate an unguessable address, retrying only on an ingest_address
  // collision (globally unique, astronomically unlikely at 128 bits, but cheap
  // to absorb). A duplicate (operator_id, domain) is a real re-add, not a
  // collision, so it stops immediately with a clear message.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { address } = generateIngestAddress();
    const fullRecord = buildDmarcRecord(address);

    const { data, error } = await supabase
      .from("dmarc_domains")
      .insert({
        // Set explicitly: this column has no auth.uid() default. RLS's with_check
        // still rejects a row written for anyone else, so this satisfies NOT NULL
        // rather than being what enforces scope.
        operator_id: user.id,
        client_id: null,
        domain,
        ingest_address: address,
        dmarc_record: fullRecord,
      })
      .select("id")
      .single();

    if (!error && data) {
      // Best-effort default senders: a duplicate is ignored and a failure here
      // does not undo the domain (the operator can add senders by hand). The
      // unique (dmarc_domain_id, dkim_selector, dkim_domain) makes it idempotent.
      await supabase.from("dmarc_known_senders").insert(
        defaultKnownSenders(domain).map((sender) => ({
          dmarc_domain_id: data.id,
          ...sender,
        }))
      );
      revalidatePath("/email");
      return {
        ok: true,
        domain,
        ingestAddress: address,
        ruaFragment: buildRuaFragment(address),
        fullRecord,
      };
    }

    if (error?.code === "23505") {
      // Only the ingest_address key is retryable; the (operator_id, domain) key
      // is a genuine duplicate.
      if (error.message.includes("ingest_address")) continue;
      return { ok: false, error: "You are already monitoring that domain." };
    }
    return { ok: false, error: "Could not add the domain." };
  }

  return {
    ok: false,
    error: "Could not generate a unique address. Try again.",
  };
}

export type KnownSenderFields = {
  label: string;
  dkim_selector: string;
  dkim_domain: string;
  envelope_domain: string;
};

export type KnownSenderResult = { ok: true } | { ok: false; error: string };

// Normalise the matching fields the same way the domain is: lowercase selector
// and domain, so the stored known sender compares cleanly against the parsed
// report's DKIM identity (which the store also holds as-received).
function cleanSender(fields: KnownSenderFields) {
  return {
    label: fields.label.trim(),
    dkim_selector: fields.dkim_selector.trim().toLowerCase(),
    dkim_domain: fields.dkim_domain.trim().toLowerCase(),
    envelope_domain: fields.envelope_domain.trim().toLowerCase() || null,
  };
}

export async function addKnownSender(
  domainId: string,
  fields: KnownSenderFields
): Promise<KnownSenderResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to manage senders." };

  const sender = cleanSender(fields);
  if (!sender.label || !sender.dkim_selector || !sender.dkim_domain) {
    return {
      ok: false,
      error: "Label, selector and DKIM domain are required.",
    };
  }

  // RLS with_check (owns_dmarc_domain) rejects a foreign domainId, so a bad id
  // surfaces as a plain failure rather than writing anywhere.
  const { error } = await supabase
    .from("dmarc_known_senders")
    .insert({ dmarc_domain_id: domainId, ...sender });
  if (error?.code === "23505") {
    return { ok: false, error: "That selector and domain is already listed." };
  }
  if (error) return { ok: false, error: "Could not add the sender." };

  revalidatePath("/email");
  return { ok: true };
}

export async function updateKnownSender(
  senderId: string,
  fields: KnownSenderFields
): Promise<KnownSenderResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to manage senders." };

  const sender = cleanSender(fields);
  if (!sender.label || !sender.dkim_selector || !sender.dkim_domain) {
    return {
      ok: false,
      error: "Label, selector and DKIM domain are required.",
    };
  }

  // No operator filter: RLS's using clause already limits the update to the
  // operator's own senders, so a foreign id simply matches nothing.
  const { error } = await supabase
    .from("dmarc_known_senders")
    .update(sender)
    .eq("id", senderId);
  if (error?.code === "23505") {
    return { ok: false, error: "That selector and domain is already listed." };
  }
  if (error) return { ok: false, error: "Could not update the sender." };

  revalidatePath("/email");
  return { ok: true };
}

export async function removeKnownSender(
  senderId: string
): Promise<KnownSenderResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to manage senders." };

  const { error } = await supabase
    .from("dmarc_known_senders")
    .delete()
    .eq("id", senderId);
  if (error) return { ok: false, error: "Could not remove the sender." };

  revalidatePath("/email");
  return { ok: true };
}

export type DeleteDomainResult = { ok: true } | { ok: false; error: string };

export async function deleteDomain(
  domainId: string
): Promise<DeleteDomainResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to manage domains." };

  // Destructive: on delete cascade removes this domain's senders, reports,
  // records and daily rollup. RLS scopes the delete to the operator's own row.
  const { error } = await supabase
    .from("dmarc_domains")
    .delete()
    .eq("id", domainId);
  if (error) return { ok: false, error: "Could not remove the domain." };

  revalidatePath("/email");
  return { ok: true };
}
