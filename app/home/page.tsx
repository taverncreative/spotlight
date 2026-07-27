import { createClient } from "@/lib/supabase/server";
import { ClientGrid } from "@/components/client-grid";
import type {
  BlogItem,
  ClientCardData,
  RequestItem,
  SocialItem,
  TaskItem,
  UnassignedCounts,
} from "@/lib/clients/counts";
import type { ClientRow } from "@/components/client-form-dialog";

// The operator home: a card per client, showing what is waiting, and expanding
// in place to show what that actually is.
//
// COUNTING STRATEGY. Six queries total regardless of client count, never one per
// client. Three of them (tasks, social, blog) select the few columns the
// expanded view needs, so opening a card costs no request at all: the detail is
// already on the page. The other two are count-only, because every request and
// print order is currently unlinked and has no client to expand under.
//
// Not a SQL view: PostgREST cannot GROUP BY, so that would be real schema, and
// at current volumes (about 50 rows across every table combined) folding in JS
// is free and needs no migration to undo.
//
// The ceiling worth knowing: supabase/config.toml sets max_rows = 1000, so each
// query silently truncates past a thousand matching rows and both counts and
// detail would quietly under-report. Nothing is near that. When any single
// filter approaches it, this is the point to swap the fold for a grouped view.
//
// deploy_hook_url is selected but never passed on: it is narrowed to a boolean
// below, before the row reaches a client component.
type ClientCipherRow = Omit<ClientRow, "has_deploy_hook"> & {
  deploy_hook_url: string | null;
};

// overdue is not selected; it is derived below from due_date against today.
type TaskRow = Omit<TaskItem, "overdue"> & { client_id: string | null };
type RequestRow = RequestItem & { client_id: string | null };
// summary/quantity/extraLines are built below from the embedded lines.
type PrintOrderRow = {
  id: string;
  client_id: string | null;
  ordered_at: string | null;
  created_at: string;
  print_order_items: { name: string; quantity: number; position: number }[];
};
type SocialRow = SocialItem & { client_id: string | null };
type BlogRow = BlogItem & { client_id: string | null };

// Built from a literal, not spread from an imported constant. That is what broke
// the counters: EMPTY_CARD_DATA's ancestor lived in the client component, so on
// the server it was a client reference, the spread produced {} and every ++
// produced NaN. A literal has nothing to substitute.
function emptyCard(): ClientCardData {
  return {
    counts: { requests: 0, tasks: 0, printOrders: 0, social: 0, blog: 0 },
    requests: [],
    tasks: [],
    printOrders: [],
    social: [],
    blog: [],
  };
}

// One pass over all five result sets into one map keyed by client id.
//
// Rows with a null client_id are skipped rather than bucketed: inbound requests
// and print orders may name a client we do not manage. Until the orphan slice
// lands that is EVERY request and print order, so both of those counters read
// zero for every client by design, not by fault.
//
// tasks/social/blog counts are the array lengths, so the number on the face and
// the rows in the expansion cannot disagree.
function buildCards(
  requests: RequestRow[],
  printOrders: PrintOrderRow[],
  tasks: TaskRow[],
  social: SocialRow[],
  blog: BlogRow[],
  today: string
): Record<string, ClientCardData> {
  const cards: Record<string, ClientCardData> = {};
  const at = (clientId: string) => (cards[clientId] ??= emptyCard());

  for (const { client_id, ...request } of requests) {
    if (!client_id) continue;
    at(client_id).requests.push(request);
  }
  for (const row of printOrders) {
    if (!row.client_id) continue;
    // The order's lines collapse to one readable line here rather than on the
    // card: the expansion is a glance at what is waiting, and the full job is
    // one click away on the client's Print tab.
    const lines = [...(row.print_order_items ?? [])].sort(
      (a, b) => a.position - b.position
    );
    const first = lines[0];
    at(row.client_id).printOrders.push({
      id: row.id,
      summary: first?.name ?? "Empty order",
      quantity: first?.quantity ?? 0,
      extraLines: Math.max(0, lines.length - 1),
      ordered_at: row.ordered_at ?? row.created_at,
    });
  }
  for (const { client_id, ...task } of tasks) {
    if (!client_id) continue;
    // due_date is a DATE column, so it arrives as 'YYYY-MM-DD' and compares
    // correctly as a string against today in the same format. No Date parsing,
    // so no timezone can shift the answer by a day.
    at(client_id).tasks.push({
      ...task,
      overdue: task.due_date !== null && task.due_date < today,
    });
  }
  for (const { client_id, ...post } of social) {
    if (!client_id) continue;
    at(client_id).social.push(post);
  }
  for (const { client_id, ...post } of blog) {
    if (!client_id) continue;
    at(client_id).blog.push(post);
  }

  for (const card of Object.values(cards)) {
    card.counts.requests = card.requests.length;
    card.counts.printOrders = card.printOrders.length;
    card.counts.tasks = card.tasks.length;
    card.counts.social = card.social.length;
    card.counts.blog = card.blog.length;
  }

  return cards;
}

export default async function HomePage() {
  const supabase = await createClient();
  const [
    clientsRes,
    requestsRes,
    printOrdersRes,
    tasksRes,
    socialRes,
    blogRes,
  ] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, slug, status, blog_base_url, deploy_hook_url, services")
      .order("name"),
    // Both carry the detail the expanded card shows. They were count-only while
    // every inbound row was unassigned; now that assignment works, a counter
    // with nothing behind it expands to an empty panel.
    supabase
      .from("client_requests")
      .select("id, client_id, submitter, message, created_at")
      .eq("status", "new")
      .order("created_at", { ascending: false }),
    supabase
      .from("print_orders")
      .select(
        "id, client_id, ordered_at, created_at, print_order_items(name, quantity, position)"
      )
      .eq("status", "new")
      .order("created_at", { ascending: false }),
    // Ordered here rather than in the component: soonest due first, soonest
    // scheduled first, newest published first. Nulls last so an undated task
    // does not head the list.
    supabase
      .from("client_tasks")
      .select("id, client_id, title, due_date")
      .eq("status", "open")
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("social_posts")
      .select("id, client_id, caption, scheduled_at")
      .eq("status", "scheduled")
      .order("scheduled_at", { ascending: true, nullsFirst: false }),
    // Published only. posts.status is constrained to draft|published (0011);
    // there is no scheduled state for blog, so there is nothing else to count.
    supabase
      .from("posts")
      .select("id, client_id, title, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false }),
  ]);

  // Drop the deploy hook ciphertext here. ClientGrid is a client component, so
  // the column is replaced by presence-only before it can travel.
  const clients: ClientRow[] = (
    (clientsRes.data ?? []) as ClientCipherRow[]
  ).map(({ deploy_hook_url, ...client }) => ({
    ...client,
    has_deploy_hook: deploy_hook_url !== null,
  }));

  const requestRows = (requestsRes.data ?? []) as RequestRow[];
  const printOrderRows = (printOrdersRes.data ?? []) as PrintOrderRow[];

  // Today in the same 'YYYY-MM-DD' shape due_date arrives in. Read once here so
  // every card judges overdue against the same instant, and so the clock is
  // never read during a client render.
  const today = new Date().toISOString().slice(0, 10);

  const cards = buildCards(
    requestRows,
    printOrderRows,
    (tasksRes.data ?? []) as TaskRow[],
    (socialRes.data ?? []) as SocialRow[],
    (blogRes.data ?? []) as BlogRow[],
    today
  );

  // The rows the grid cannot show, because they belong to no client.
  const unassigned: UnassignedCounts = {
    requests: requestRows.filter((row) => !row.client_id).length,
    printOrders: printOrderRows.filter((row) => !row.client_id).length,
  };

  return (
    <ClientGrid clients={clients} cards={cards} unassigned={unassigned} />
  );
}
