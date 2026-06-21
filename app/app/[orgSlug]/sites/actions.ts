"use server";

import { requireWorkspaceAccess } from "@/lib/workspace";
import {
  requireModuleEnabled,
  requirePermission,
  type Capability,
} from "@/lib/authorisation";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";
import {
  siteCreateSchema,
  siteCustomerSchema,
  siteIdSchema,
  siteUpdateSchema,
} from "@/lib/sites/schemas";

// The Sites server actions. Sites are part of customer management, so they
// gate on the customers module and follow the recorded action shape
// (workspace access, module gate, role gate, Zod parse, organisation-scoped
// query). Every action is scoped to a parent customer that must be active and
// in the organisation, returning a calm null otherwise, the same way quote
// line items check their parent. Sites soft-delete.

const SITE_COLUMNS =
  "id, customer_id, name, address_line1, address_line2, town, county, postcode, access_notes, custom_fields, created_at, updated_at, deleted_at";

async function gate(orgSlug: string, capability: Capability) {
  const context = await requireWorkspaceAccess(orgSlug);
  await requireModuleEnabled(context.organisation, "customers");
  requirePermission(context.membership, capability);
  return context;
}

// True when the customer exists, is active and belongs to the organisation.
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

// The parent customer id of a site in this organisation, or null. `deleted`
// chooses an active site (update, delete) or a soft-deleted one (restore).
async function siteParentCustomer(
  organisationId: string,
  siteId: string,
  deleted: boolean
) {
  const supabase = await createClient();
  let query = supabase
    .from("sites")
    .select("customer_id")
    .eq("organisation_id", organisationId)
    .eq("id", siteId);
  query = deleted
    ? query.not("deleted_at", "is", null)
    : query.is("deleted_at", null);
  const { data } = await query.maybeSingle();
  return (data?.customer_id as string | undefined) ?? null;
}

export async function listSites(orgSlug: string, input: unknown) {
  const { organisation } = await gate(orgSlug, "record.read");
  const { customer_id } = siteCustomerSchema.parse(input);
  if (!(await customerInOrganisation(organisation.id, customer_id))) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .select(SITE_COLUMNS)
    .eq("organisation_id", organisation.id)
    .eq("customer_id", customer_id)
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

export async function listDeletedSites(orgSlug: string, input: unknown) {
  const { organisation } = await gate(orgSlug, "record.read");
  const { customer_id } = siteCustomerSchema.parse(input);
  if (!(await customerInOrganisation(organisation.id, customer_id))) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .select(SITE_COLUMNS)
    .eq("organisation_id", organisation.id)
    .eq("customer_id", customer_id)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function getSite(orgSlug: string, input: unknown) {
  const { organisation } = await gate(orgSlug, "record.read");
  const { id } = siteIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .select(SITE_COLUMNS)
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  // The parent customer must still be active and in the organisation.
  if (!(await customerInOrganisation(organisation.id, data.customer_id))) {
    return null;
  }
  return data;
}

export async function createSite(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const fields = siteCreateSchema.parse(input);
  if (!(await customerInOrganisation(organisation.id, fields.customer_id))) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .insert({
      ...fields,
      organisation_id: organisation.id,
      created_by: user.id,
      updated_by: user.id,
    })
    .select(SITE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateSite(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id, ...fields } = siteUpdateSchema.parse(input);

  const customerId = await siteParentCustomer(organisation.id, id, false);
  if (!customerId || !(await customerInOrganisation(organisation.id, customerId))) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .update({ ...fields, updated_by: user.id })
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .is("deleted_at", null)
    .select(SITE_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function softDeleteSite(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id } = siteIdSchema.parse(input);

  const customerId = await siteParentCustomer(organisation.id, id, false);
  if (!customerId || !(await customerInOrganisation(organisation.id, customerId))) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
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
      action: "site.soft_deleted",
      targetType: "site",
      targetId: data.id,
    });
  }
  return data;
}

export async function restoreSite(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id } = siteIdSchema.parse(input);

  const customerId = await siteParentCustomer(organisation.id, id, true);
  if (!customerId || !(await customerInOrganisation(organisation.id, customerId))) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
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
      action: "site.restored",
      targetType: "site",
      targetId: data.id,
    });
  }
  return data;
}
