import { createClient } from "@/lib/supabase/server";
import { DueTasks, type DueTaskRow } from "@/components/due-tasks";

// The operator-level cross-client "what's due" view. RLS on client_tasks
// (owns_client) scopes every row to the operator, so no client filter is needed
// or wanted; the clients embed names each task's client and is itself readable
// under the clients policy. Due-soonest-first, undated last — the grouping into
// urgency bands happens client-side in DueTasks so "today" is per-request.
export default async function DuePage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_tasks")
    .select("id, title, due_date, recurrence, clients(name, slug)")
    .eq("status", "open")
    .order("due_date", { ascending: true, nullsFirst: false });
  // A to-one FK embed returns an object at runtime, but supabase-js infers it as
  // an array, so cast through unknown — the same treatment the monitoring board
  // gives its clients(name, slug) join in app/home/page.tsx.
  const tasks = (data ?? []) as unknown as DueTaskRow[];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Due</h1>
        <p className="text-sm text-muted-foreground">
          Open tasks across every client, soonest first. Completing a repeating
          task rolls it forward to its next date.
        </p>
      </div>

      <DueTasks tasks={tasks} />
    </div>
  );
}
