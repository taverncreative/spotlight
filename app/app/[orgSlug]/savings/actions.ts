"use server";

import { requireWorkspaceAccess } from "@/lib/workspace";
import {
  requireModuleEnabled,
  requirePermission,
  type Capability,
} from "@/lib/authorisation";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";
import { computeSavingsTotals, type Cadence } from "@/lib/savings/totals";
import {
  savingsCreateSchema,
  savingsIdSchema,
  savingsUpdateSchema,
} from "@/lib/savings/schemas";

// The Savings server actions (Pass 11A). They follow the recorded action shape
// (workspace access, subscription_savings-module gate, role gate, Zod parse,
// organisation-scoped query). Reads are record.read; writes are record.write.
// No deleted_at: a savings item hard-deletes (the workspace manages its own
// list), and the delete is audited. listSavings totals the saving from the
// stored pence; no derived total is stored.

const SAVINGS_COLUMNS =
  "id, label, amount_pence, cadence, note, cancelled_on, created_by, created_at, updated_at";

type SavingsItemRow = {
  id: string;
  label: string;
  amount_pence: number;
  cadence: Cadence;
  note: string | null;
  cancelled_on: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

async function gate(orgSlug: string, capability: Capability) {
  const context = await requireWorkspaceAccess(orgSlug);
  await requireModuleEnabled(context.organisation, "subscription_savings");
  requirePermission(context.membership, capability);
  return context;
}

// The organisation's savings items plus the cadence-normalised totals. The
// totals are computed here from the stored pence (computeSavingsTotals), never
// stored, so they can never drift from the items.
export async function listSavings(orgSlug: string) {
  const { organisation } = await gate(orgSlug, "record.read");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("savings_items")
    .select(SAVINGS_COLUMNS)
    .eq("organisation_id", organisation.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const items = (data ?? []) as SavingsItemRow[];
  return { items, totals: computeSavingsTotals(items) };
}

// One item by id, for the edit screen. record.read, organisation-scoped; a
// missing or cross-tenant id is a calm null.
export async function getSavingsItem(orgSlug: string, input: unknown) {
  const { organisation } = await gate(orgSlug, "record.read");
  const { id } = savingsIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("savings_items")
    .select(SAVINGS_COLUMNS)
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as SavingsItemRow | null;
}

export async function createSavingsItem(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const fields = savingsCreateSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("savings_items")
    .insert({
      label: fields.label,
      amount_pence: fields.amount_pence,
      cadence: fields.cadence,
      note: fields.note ?? null,
      cancelled_on: fields.cancelled_on ?? null,
      organisation_id: organisation.id,
      created_by: user.id,
      updated_by: user.id,
    })
    .select(SAVINGS_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as SavingsItemRow;
}

export async function updateSavingsItem(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id, ...fields } = savingsUpdateSchema.parse(input);

  // Only the provided keys change; undefined means "leave as is". note and
  // cancelled_on normalise to null by the schema when blank, so an explicit
  // null clears them.
  const changes: Record<string, unknown> = { updated_by: user.id };
  if (fields.label !== undefined) changes.label = fields.label;
  if (fields.amount_pence !== undefined) changes.amount_pence = fields.amount_pence;
  if (fields.cadence !== undefined) changes.cadence = fields.cadence;
  if (fields.note !== undefined) changes.note = fields.note;
  if (fields.cancelled_on !== undefined) changes.cancelled_on = fields.cancelled_on;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("savings_items")
    .update(changes)
    .eq("organisation_id", organisation.id)
    .eq("id", id)
    .select(SAVINGS_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as SavingsItemRow | null;
}

export async function deleteSavingsItem(orgSlug: string, input: unknown) {
  const { organisation, user } = await gate(orgSlug, "record.write");
  const { id } = savingsIdSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("savings_items")
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
      action: "savings_item.deleted",
      targetType: "savings_item",
      targetId: data.id,
    });
  }
  return data;
}
