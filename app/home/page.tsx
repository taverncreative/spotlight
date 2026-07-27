import { createClient } from "@/lib/supabase/server";
import {
  ClientGrid,
  ZERO_COUNTS,
  type ClientCounts,
} from "@/components/client-grid";
import type { ClientRow } from "@/components/client-form-dialog";

// The operator home: a card per client, with the five counts that say what is
// actually waiting.
//
// COUNTING STRATEGY. Five lean queries, each selecting only client_id under a
// status filter, tallied in one pass. Not one query per client: that would be
// 5 x clients round trips to answer a question the database can serve in five.
// Not a SQL view either, yet -- PostgREST cannot GROUP BY, so a view would be
// real schema, and at current volumes (about 50 rows across every table
// combined) folding in JS is free and needs no migration to undo.
//
// The ceiling worth knowing: supabase/config.toml sets max_rows = 1000, so each
// query silently truncates past a thousand matching rows and the counts would
// quietly under-report. Nothing is near that. When any single filter approaches
// it, this is the point to swap the fold for a grouped view.
//
// deploy_hook_url is selected but never passed on: it is narrowed to a boolean
// below, before the row reaches a client component.
type ClientCipherRow = Omit<ClientRow, "has_deploy_hook"> & {
  deploy_hook_url: string | null;
};

type CountRow = { client_id: string | null };

// Fold the five result sets into one map keyed by client id. Rows with a null
// client_id are skipped rather than bucketed: inbound requests and print orders
// may name a client we do not manage, and those belong to no card. Until the
// orphan slice lands that is EVERY request and print order, so both of those
// counters read zero everywhere by design, not by fault.
function tally(
  sets: { key: keyof ClientCounts; rows: CountRow[] }[]
): Record<string, ClientCounts> {
  const counts: Record<string, ClientCounts> = {};
  for (const { key, rows } of sets) {
    for (const row of rows) {
      if (!row.client_id) continue;
      counts[row.client_id] ??= { ...ZERO_COUNTS };
      counts[row.client_id][key]++;
    }
  }
  return counts;
}

export default async function HomePage() {
  const supabase = await createClient();
  const [
    clientsRes,
    requestsRes,
    tasksRes,
    printOrdersRes,
    socialRes,
    blogRes,
  ] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, slug, status, blog_base_url, deploy_hook_url")
      .order("name"),
    supabase.from("client_requests").select("client_id").eq("status", "new"),
    supabase.from("client_tasks").select("client_id").eq("status", "open"),
    supabase.from("print_orders").select("client_id").eq("status", "new"),
    supabase.from("social_posts").select("client_id").eq("status", "scheduled"),
    // Published only. posts.status is constrained to draft|published (0011);
    // there is no scheduled state for blog, so there is nothing else to count.
    supabase.from("posts").select("client_id").eq("status", "published"),
  ]);

  // Drop the deploy hook ciphertext here. ClientGrid is a client component, so
  // the column is replaced by presence-only before it can travel.
  const clients: ClientRow[] = (
    (clientsRes.data ?? []) as ClientCipherRow[]
  ).map(({ deploy_hook_url, ...client }) => ({
    ...client,
    has_deploy_hook: deploy_hook_url !== null,
  }));

  const counts = tally([
    { key: "requests", rows: (requestsRes.data ?? []) as CountRow[] },
    { key: "tasks", rows: (tasksRes.data ?? []) as CountRow[] },
    { key: "printOrders", rows: (printOrdersRes.data ?? []) as CountRow[] },
    { key: "social", rows: (socialRes.data ?? []) as CountRow[] },
    { key: "blog", rows: (blogRes.data ?? []) as CountRow[] },
  ]);

  return <ClientGrid clients={clients} counts={counts} />;
}
