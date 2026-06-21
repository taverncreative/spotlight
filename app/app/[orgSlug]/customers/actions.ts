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
  customerCreateSchema,
  customerIdSchema,
  customerListFilterSchema,
  customerUpdateSchema,
} from "@/lib/customers/schemas";

// The Customers server actions, following the action shape set by leads:
// workspace access, module gate, role gate, Zod validation, then an
// organisation-scoped query with deleted_at handled in the query layer.

const CUSTOMER_COLUMNS =
  "id, name, type, email, phone, address_line1, address_line2, town, county, postcode, custom_fields, created_at, updated_at, deleted_at";

async function gate(orgSlug: string, capability: Capability) {
  const context = await requireWorkspaceAccess(orgSlug);
  await requireModuleEnabled(context.organisation, "customers");
  requirePermission(context.membership, capability);
  return context;
}

export async function listCustomers(orgSlug: string, filter: unknown = {}) {
  const { organisation } = await gate(orgSlug, "record.read");
  const parsed = customerListFilterSchema.parse(filter);

  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select(CUSTOMER_COLUMNS)
    .eq("organisation_id", organisation.id)
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (parsed.type) {
    query = query.eq("type", parsed.type);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function listDeletedCustomers(orgSlug: string) {
  const { organisation } = await gate(orgSlug, "record.read");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select(CUSTOMER_COLUMNS)
    .eq("organisation_id", organisation.id)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function getCustomer(orgSlug: string, input: unknown) {
  const { organisation } = await gate(orgSlug, "record.read");
  const { id } = customerIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select(CUSTOMER_COLUMNS)
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createCustomer(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const fields = customerCreateSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .insert({
      ...fields,
      organisation_id: organisation.id,
      created_by: user.id,
      updated_by: user.id,
    })
    .select(CUSTOMER_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateCustomer(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id, ...fields } = customerUpdateSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .update({ ...fields, updated_by: user.id })
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .is("deleted_at", null)
    .select(CUSTOMER_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function softDeleteCustomer(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id } = customerIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
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
      action: "customer.soft_deleted",
      targetType: "customer",
      targetId: data.id,
    });
  }
  return data;
}

export async function restoreCustomer(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id } = customerIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
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
      action: "customer.restored",
      targetType: "customer",
      targetId: data.id,
    });
  }
  return data;
}
