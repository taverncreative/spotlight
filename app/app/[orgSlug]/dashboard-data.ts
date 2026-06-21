import "server-only";
import { createClient } from "@/lib/supabase/server";
import { computeSavingsTotals, type Cadence } from "@/lib/savings/totals";
import { listTasks } from "./tasks/actions";

// The dashboard data loader (Phase 12). Each figure is one count or sum query
// scoped to the workspace; nothing fans out per row, and a module the workspace
// does not have is not queried at all. Reuses the savings totals helper and the
// tasks overdue derivation (listTasks with the overdue filter) rather than
// recomputing either.
//
// "Open" means active, not in a terminal state, applied consistently across the
// modules: open leads are not converted, rejected or spam; open quotes are not
// accepted, declined or expired; open tasks are not done or cancelled.

const OPEN_LEAD_STATUSES = ["new", "contacted", "qualified"];
const OPEN_QUOTE_STATUSES = ["draft", "sent"];
const ACTIVE_TASK_STATUSES = ["open", "in_progress"];

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export type AttentionTask = { id: string; title: string; due_at: string | null };
export type AttentionQuote = {
  id: string;
  quote_number: number;
  title: string | null;
  total_pence: number;
};

export type DashboardData = {
  leads?: { open: number; last7: number };
  customers?: { total: number };
  quotes?: { open: number; openValuePence: number; accepted30: number };
  tasks?: { open: number; overdue: number };
  savings?: { monthlyPence: number };
  attention: {
    overdueTasks: AttentionTask[];
    unansweredQuotes: AttentionQuote[];
  };
};

// How many recent overdue tasks and unanswered quotes the attention area lists;
// the full set is one click away on the filtered list.
const ATTENTION_LIMIT = 5;

export async function loadDashboard(
  orgSlug: string,
  organisationId: string,
  enabledModules: string[]
): Promise<DashboardData> {
  const supabase = await createClient();
  const has = (key: string) => enabledModules.includes(key);

  async function loadLeads() {
    if (!has("leads")) return undefined;
    const [open, last7] = await Promise.all([
      supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("organisation_id", organisationId)
        .is("deleted_at", null)
        .in("status", OPEN_LEAD_STATUSES),
      supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("organisation_id", organisationId)
        .is("deleted_at", null)
        .gte("created_at", daysAgoIso(7)),
    ]);
    if (open.error) throw new Error(open.error.message);
    if (last7.error) throw new Error(last7.error.message);
    return { open: open.count ?? 0, last7: last7.count ?? 0 };
  }

  async function loadCustomers() {
    if (!has("customers")) return undefined;
    const { count, error } = await supabase
      .from("customers")
      .select("*", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    return { total: count ?? 0 };
  }

  async function loadQuotes() {
    if (!has("quotes"))
      return { card: undefined, unanswered: [] as AttentionQuote[] };
    // One row read for the open quotes (count is the length, value is the sum of
    // their stored pence), one count for recent acceptances, one short list of
    // the unanswered (sent) quotes for the attention area. Acceptance has no
    // timestamp of its own, so updated_at stands in: a quote locks against edits
    // once it leaves draft, so its updated_at is the moment it was accepted.
    const [openRows, accepted30, sent] = await Promise.all([
      supabase
        .from("quotes")
        .select("total_pence")
        .eq("organisation_id", organisationId)
        .is("deleted_at", null)
        .in("status", OPEN_QUOTE_STATUSES),
      supabase
        .from("quotes")
        .select("*", { count: "exact", head: true })
        .eq("organisation_id", organisationId)
        .is("deleted_at", null)
        .eq("status", "accepted")
        .gte("updated_at", daysAgoIso(30)),
      supabase
        .from("quotes")
        .select("id, quote_number, title, total_pence")
        .eq("organisation_id", organisationId)
        .is("deleted_at", null)
        .eq("status", "sent")
        .order("issued_at", { ascending: false, nullsFirst: false })
        .order("quote_number", { ascending: false })
        .limit(ATTENTION_LIMIT),
    ]);
    if (openRows.error) throw new Error(openRows.error.message);
    if (accepted30.error) throw new Error(accepted30.error.message);
    if (sent.error) throw new Error(sent.error.message);

    const openValuePence = (openRows.data ?? []).reduce(
      (sum, row) => sum + (row.total_pence as number),
      0
    );
    return {
      card: {
        open: openRows.data?.length ?? 0,
        openValuePence,
        accepted30: accepted30.count ?? 0,
      },
      unanswered: (sent.data ?? []) as AttentionQuote[],
    };
  }

  async function loadTasks() {
    if (!has("tasks"))
      return { card: undefined, overdue: [] as AttentionTask[] };
    // Reuse the overdue derivation: listTasks with the overdue filter returns
    // every overdue task (so its length is the exact count), and a separate
    // count gives the active tasks.
    const [openCount, overdueTasks] = await Promise.all([
      supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .eq("organisation_id", organisationId)
        .in("status", ACTIVE_TASK_STATUSES),
      listTasks(orgSlug, { overdue: true }),
    ]);
    if (openCount.error) throw new Error(openCount.error.message);
    return {
      card: { open: openCount.count ?? 0, overdue: overdueTasks.length },
      overdue: overdueTasks.slice(0, ATTENTION_LIMIT).map((t) => ({
        id: t.id,
        title: t.title,
        due_at: t.due_at,
      })),
    };
  }

  async function loadSavings() {
    if (!has("subscription_savings")) return undefined;
    const { data, error } = await supabase
      .from("savings_items")
      .select("amount_pence, cadence")
      .eq("organisation_id", organisationId);
    if (error) throw new Error(error.message);
    const totals = computeSavingsTotals(
      (data ?? []) as { amount_pence: number; cadence: Cadence }[]
    );
    return { monthlyPence: totals.monthlyTotalPence };
  }

  const [leads, customers, quotes, tasks, savings] = await Promise.all([
    loadLeads(),
    loadCustomers(),
    loadQuotes(),
    loadTasks(),
    loadSavings(),
  ]);

  return {
    leads,
    customers,
    quotes: quotes.card,
    tasks: tasks.card,
    savings,
    attention: {
      overdueTasks: tasks.overdue,
      unansweredQuotes: quotes.unanswered,
    },
  };
}
