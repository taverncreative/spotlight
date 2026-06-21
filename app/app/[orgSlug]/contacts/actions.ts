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
  contactCreateSchema,
  contactCustomerSchema,
  contactIdSchema,
  contactUpdateSchema,
} from "@/lib/contacts/schemas";
import type { SupabaseClient } from "@supabase/supabase-js";

// The Contacts server actions. Like sites, contacts are part of customer
// management, so they gate on the customers module and are scoped to a parent
// customer that must be active and in the organisation (calm null otherwise).
// Contacts hard-delete, so the permanent delete is audited. Setting a contact
// as primary clears is_primary on the customer's other contacts in the same
// operation, so at most one contact per customer is primary.

const CONTACT_COLUMNS =
  "id, customer_id, name, email, phone, job_title, is_primary, created_at, updated_at";

async function gate(orgSlug: string, capability: Capability) {
  const context = await requireWorkspaceAccess(orgSlug);
  await requireModuleEnabled(context.organisation, "customers");
  requirePermission(context.membership, capability);
  return context;
}

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

// The parent customer id of a contact in this organisation, or null.
async function contactParentCustomer(organisationId: string, contactId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("contacts")
    .select("customer_id")
    .eq("organisation_id", organisationId)
    .eq("id", contactId)
    .maybeSingle();
  return (data?.customer_id as string | undefined) ?? null;
}

// Clears is_primary on a customer's other contacts, so setting one primary
// leaves at most one. exceptId is the contact being made primary on update.
async function clearOtherPrimaries(
  supabase: SupabaseClient,
  organisationId: string,
  customerId: string,
  userId: string,
  exceptId?: string
) {
  let query = supabase
    .from("contacts")
    .update({ is_primary: false, updated_by: userId })
    .eq("organisation_id", organisationId)
    .eq("customer_id", customerId)
    .eq("is_primary", true);
  if (exceptId) {
    query = query.neq("id", exceptId);
  }
  const { error } = await query;
  if (error) throw new Error(error.message);
}

export async function listContacts(orgSlug: string, input: unknown) {
  const { organisation } = await gate(orgSlug, "record.read");
  const { customer_id } = contactCustomerSchema.parse(input);
  if (!(await customerInOrganisation(organisation.id, customer_id))) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contacts")
    .select(CONTACT_COLUMNS)
    .eq("organisation_id", organisation.id)
    .eq("customer_id", customer_id)
    .order("is_primary", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

export async function createContact(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const fields = contactCreateSchema.parse(input);
  if (!(await customerInOrganisation(organisation.id, fields.customer_id))) {
    return null;
  }

  const supabase = await createClient();
  // A new primary contact clears any existing primary first.
  if (fields.is_primary === true) {
    await clearOtherPrimaries(
      supabase,
      organisation.id,
      fields.customer_id,
      user.id
    );
  }

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      ...fields,
      organisation_id: organisation.id,
      created_by: user.id,
      updated_by: user.id,
    })
    .select(CONTACT_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateContact(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id, ...fields } = contactUpdateSchema.parse(input);

  const customerId = await contactParentCustomer(organisation.id, id);
  if (!customerId || !(await customerInOrganisation(organisation.id, customerId))) {
    return null;
  }

  const supabase = await createClient();
  // Promoting this contact to primary demotes the customer's others.
  if (fields.is_primary === true) {
    await clearOtherPrimaries(supabase, organisation.id, customerId, user.id, id);
  }

  const { data, error } = await supabase
    .from("contacts")
    .update({ ...fields, updated_by: user.id })
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .select(CONTACT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteContact(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id } = contactIdSchema.parse(input);

  const customerId = await contactParentCustomer(organisation.id, id);
  if (!customerId || !(await customerInOrganisation(organisation.id, customerId))) {
    return null;
  }

  // Contacts have no deleted_at: this is a permanent delete, so it is audited.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contacts")
    .delete()
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (data) {
    await writeAuditLog({
      organisationId: organisation.id,
      actorUserId: user.id,
      action: "contact.deleted",
      targetType: "contact",
      targetId: data.id,
    });
  }
  return data;
}
