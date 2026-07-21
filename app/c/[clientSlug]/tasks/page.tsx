import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { TasksList } from "@/components/tasks-list";
import { type TaskRow } from "@/components/task-form-dialog";

// The per-client Tasks module: the operator's own operational to-do list, RLS
// scoped via owns_client. Ordered due-soonest-first (undated tasks last), so the
// open list the client component renders is already in priority order.
export default async function TasksPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const { client } = await requireClient(clientSlug);

  const supabase = await createClient();
  const { data } = await supabase
    .from("client_tasks")
    .select("id, title, notes, due_date, status, recurrence, created_at")
    .eq("client_id", client.id)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  const tasks = (data ?? []) as TaskRow[];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted-foreground">
          Your own operational to-do list for {client.name}. Recurring tasks
          roll forward to their next date when you complete them.
        </p>
      </div>

      <TasksList clientId={client.id} tasks={tasks} />
    </div>
  );
}
