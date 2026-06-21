"use server";

import { randomBytes } from "node:crypto";
import { requireWorkspaceAccess } from "@/lib/workspace";
import {
  requireModuleEnabled,
  requirePermission,
  type Capability,
} from "@/lib/authorisation";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";
import {
  lineItemAddSchema,
  lineItemIdSchema,
  lineItemUpdateSchema,
  quoteCreateSchema,
  quoteIdSchema,
  quoteListFilterSchema,
  quoteTransitionSchema,
  quoteUpdateSchema,
} from "@/lib/quotes/schemas";
import { QUOTE_TRANSITIONS } from "@/lib/quotes/transitions";
import { commitQuoteTransition } from "@/lib/quotes/transition";

// The Quotes server actions, following the recorded action shape. Gated on
// the quotes module only: reading a quote's customer name is a normal
// membership read. Totals are database-maintained and never written here.

const QUOTE_COLUMNS =
  "id, quote_number, title, status, customer_id, site_id, issued_at, valid_until, subtotal_pence, vat_pence, total_pence, custom_fields, public_token, first_viewed_at, created_at, updated_at, deleted_at";

const SITE_EMBED =
  "sites (name, address_line1, address_line2, town, county, postcode)";

async function gate(orgSlug: string, capability: Capability) {
  const context = await requireWorkspaceAccess(orgSlug);
  await requireModuleEnabled(context.organisation, "quotes");
  requirePermission(context.membership, capability);
  return context;
}

// True when the customer exists, is active and belongs to the organisation.
// The tenant-scoped FK is the backstop; this gives callers a calm null
// instead of a constraint error.
async function customerInOrganisation(
  organisationId: string,
  customerId: string
) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("id", customerId)
    .is("deleted_at", null)
    .maybeSingle();
  return data !== null;
}

// True when the site exists, is active, belongs to the customer and is in the
// organisation. The picker only offers valid sites; this is the server-side
// check, and the composite FK is the database backstop.
async function siteBelongsToCustomer(
  organisationId: string,
  customerId: string,
  siteId: string
) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sites")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("customer_id", customerId)
    .eq("id", siteId)
    .is("deleted_at", null)
    .maybeSingle();
  return data !== null;
}

export async function listQuotes(orgSlug: string, filter: unknown = {}) {
  const { organisation } = await gate(orgSlug, "record.read");
  const parsed = quoteListFilterSchema.parse(filter);

  const supabase = await createClient();
  let query = supabase
    .from("quotes")
    .select(`${QUOTE_COLUMNS}, customers (name)`)
    .eq("organisation_id", organisation.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (parsed.status) {
    query = query.eq("status", parsed.status);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function listDeletedQuotes(orgSlug: string) {
  const { organisation } = await gate(orgSlug, "record.read");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quotes")
    .select(`${QUOTE_COLUMNS}, customers (name)`)
    .eq("organisation_id", organisation.id)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function getQuote(orgSlug: string, input: unknown) {
  const { organisation } = await gate(orgSlug, "record.read");
  const { id } = quoteIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quotes")
    .select(
      `${QUOTE_COLUMNS}, customers (name), ${SITE_EMBED}, quote_line_items (id, position, description, quantity, unit_price_pence, vat_rate, line_total_pence)`
    )
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .is("deleted_at", null)
    .order("position", { referencedTable: "quote_line_items", ascending: true })
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createQuote(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const fields = quoteCreateSchema.parse(input);

  if (!(await customerInOrganisation(organisation.id, fields.customer_id))) {
    return null;
  }

  const supabase = await createClient();
  const allocation = await supabase.rpc("allocate_quote_number", {
    org_id: organisation.id,
  });
  if (allocation.error) throw new Error(allocation.error.message);

  const { data, error } = await supabase
    .from("quotes")
    .insert({
      ...fields,
      organisation_id: organisation.id,
      quote_number: allocation.data as number,
      created_by: user.id,
      updated_by: user.id,
    })
    .select(QUOTE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateQuote(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id, site_id, ...fields } = quoteUpdateSchema.parse(input);

  if (
    fields.customer_id &&
    !(await customerInOrganisation(organisation.id, fields.customer_id))
  ) {
    return null;
  }

  // The site is scoped to the quote's customer, so resolve it against the
  // current quote and the (possibly changed) customer. Editing locks outside
  // draft, so only a draft quote is read and updated.
  const supabase = await createClient();
  const { data: current } = await supabase
    .from("quotes")
    .select("customer_id, site_id")
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .eq("status", "draft")
    .is("deleted_at", null)
    .maybeSingle();
  if (!current) return null;

  const effectiveCustomerId = fields.customer_id ?? current.customer_id;
  const customerChanged =
    fields.customer_id !== undefined &&
    fields.customer_id !== current.customer_id;

  const changes: Record<string, unknown> = { ...fields, updated_by: user.id };

  if (site_id !== undefined) {
    // An explicit choice or clear from the picker.
    if (site_id === null) {
      changes.site_id = null;
    } else if (
      await siteBelongsToCustomer(organisation.id, effectiveCustomerId, site_id)
    ) {
      changes.site_id = site_id;
    } else if (customerChanged) {
      // A stale picker value left over from the previous customer: drop it.
      changes.site_id = null;
    } else {
      // A site that does not belong to this customer, chosen deliberately.
      return null;
    }
  } else if (
    customerChanged &&
    current.site_id &&
    !(await siteBelongsToCustomer(
      organisation.id,
      effectiveCustomerId,
      current.site_id
    ))
  ) {
    // Customer changed without resubmitting the site, and the existing site is
    // not owned by the new customer: clear it.
    changes.site_id = null;
  }

  const { data, error } = await supabase
    .from("quotes")
    .update(changes)
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .eq("status", "draft")
    .is("deleted_at", null)
    .select(QUOTE_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// Moves a quote through the lifecycle. The transition map in
// lib/quotes/transitions.ts is the single source of allowed moves; the
// update is guarded on the observed current status so a race cannot apply
// a move twice. Marking sent stamps issued_at; returning to draft clears
// it. Every applied transition is audit logged.
export async function transitionQuoteStatus(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id, to } = quoteTransitionSchema.parse(input);

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("quotes")
    .select("id, status, public_token")
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!current) return null;

  if (!QUOTE_TRANSITIONS[current.status]?.includes(to)) {
    return { invalid: true as const, from: current.status, to };
  }

  const changes: Record<string, unknown> = { status: to, updated_by: user.id };
  if (to === "sent") {
    changes.issued_at = new Date().toISOString();
    // First send mints the public link; returning to draft keeps it, so a
    // re-sent quote keeps the same link.
    if (!current.public_token) {
      changes.public_token = randomBytes(32).toString("base64url");
    }
  }
  if (to === "draft") changes.issued_at = null;

  // The status-guarded update, the audit and any quote-lifecycle automation fire
  // happen at the single shared commit point, the same one the public accept and
  // decline use, so an accepted or declined transition fires its automation once
  // regardless of which path made it.
  return commitQuoteTransition(supabase, {
    organisationId: organisation.id,
    quoteId: id,
    from: current.status,
    to,
    changes,
    auditActorUserId: user.id,
    selectColumns: QUOTE_COLUMNS,
  });
}

export async function softDeleteQuote(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id } = quoteIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quotes")
    .update({ deleted_at: new Date().toISOString(), updated_by: user.id })
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (data) {
    await writeAuditLog({
      organisationId: organisation.id,
      actorUserId: user.id,
      action: "quote.soft_deleted",
      targetType: "quote",
      targetId: data.id,
    });
  }
  return data;
}

export async function restoreQuote(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id } = quoteIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quotes")
    .update({ deleted_at: null, updated_by: user.id })
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .not("deleted_at", "is", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (data) {
    await writeAuditLog({
      organisationId: organisation.id,
      actorUserId: user.id,
      action: "quote.restored",
      targetType: "quote",
      targetId: data.id,
    });
  }
  return data;
}

// Line items: routine quote-building, deliberately not audited (the quote's
// own soft delete is). The database totals triggers keep the parent quote
// correct on every change; nothing here touches the money columns.

const LINE_COLUMNS =
  "id, quote_id, position, description, quantity, unit_price_pence, vat_rate, line_total_pence";

// True when the quote exists, is active, belongs to the organisation and is
// still a draft. Line and header editing lock outside draft.
async function draftQuoteInOrganisation(
  organisationId: string,
  quoteId: string
) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("quotes")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("id", quoteId)
    .eq("status", "draft")
    .is("deleted_at", null)
    .maybeSingle();
  return data !== null;
}

export async function addLineItem(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const fields = lineItemAddSchema.parse(input);

  if (!(await draftQuoteInOrganisation(organisation.id, fields.quote_id))) {
    return null;
  }

  const supabase = await createClient();
  const { data: lastLine } = await supabase
    .from("quote_line_items")
    .select("position")
    .eq("organisation_id", organisation.id)
    .eq("quote_id", fields.quote_id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (lastLine?.position ?? 0) + 1;

  const { data, error } = await supabase
    .from("quote_line_items")
    .insert({
      ...fields,
      organisation_id: organisation.id,
      position,
      created_by: user.id,
      updated_by: user.id,
    })
    .select(LINE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// True when the line exists in the organisation and its parent quote is
// active. None of the line actions operates on a binned quote's lines.
async function lineOnActiveQuote(organisationId: string, lineId: string) {
  const supabase = await createClient();
  const { data: line } = await supabase
    .from("quote_line_items")
    .select("quote_id")
    .eq("organisation_id", organisationId)
    .eq("id", lineId)
    .maybeSingle();
  if (!line) return false;
  return draftQuoteInOrganisation(organisationId, line.quote_id);
}

export async function updateLineItem(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id, ...fields } = lineItemUpdateSchema.parse(input);

  if (!(await lineOnActiveQuote(organisation.id, id))) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quote_line_items")
    .update({ ...fields, updated_by: user.id })
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .select(LINE_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function removeLineItem(orgSlug: string, input: unknown) {
  const { organisation } = await gate(orgSlug, "record.write");
  const { id } = lineItemIdSchema.parse(input);

  if (!(await lineOnActiveQuote(organisation.id, id))) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quote_line_items")
    .delete()
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
