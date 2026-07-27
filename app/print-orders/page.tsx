import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { createClient } from "@/lib/supabase/server";
import {
  assignPrintOrderToClient,
  updatePrintOrderStatus,
} from "@/lib/print-orders/actions";
import {
  AssignClient,
  type AssignableClient,
} from "@/components/assign-client";

type PrintOrderItem = {
  name: string;
  quantity: number;
  reference: string | null;
  position: number;
};

type PrintOrderRow = {
  id: string;
  source_app: string;
  order_id: string | null;
  client_id: string | null;
  client_name: string;
  submitter: string | null;
  status: string;
  ordered_at: string | null;
  created_at: string;
  print_order_items: PrintOrderItem[];
};

// Status tabs, the same link-based pattern the requests inbox uses. "empty" is
// the message when the tab filters everything out.
const STATUS_TABS: {
  key: string | null;
  label: string;
  empty: string;
}[] = [
  { key: null, label: "All", empty: "" },
  { key: "new", label: "New", empty: "Nothing waiting to print." },
  { key: "printing", label: "Printing", empty: "Nothing on the press." },
  { key: "done", label: "Done", empty: "Nothing marked done yet." },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// A filter link that keeps whichever other filter is already set, so status and
// source compose instead of clobbering each other.
function filterHref(status: string | null, source: string | null): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (source) params.set("source", source);
  const query = params.toString();
  return query ? `/print-orders?${query}` : "/print-orders";
}

// One move button. A plain form per action, mirroring the requests inbox: no
// client component needed for a status change.
function MoveButton({
  id,
  status,
  label,
  variant = "outline",
}: {
  id: string;
  status: string;
  label: string;
  variant?: "outline" | "ghost";
}) {
  return (
    <form action={updatePrintOrderStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" variant={variant} size="sm">
        {label}
      </Button>
    </form>
  );
}

// The cross-source print queue: every inbound print order in one list, newest
// first, whichever app sent it and whether or not it names a client we manage.
// Operator-level by nature, so it sits at the top level rather than under a
// client, exactly like /requests: these are fulfilment jobs John works through,
// not a per-client module.
//
// RLS (print_orders_operator_select) scopes the read; the layout gates auth.
export default async function PrintOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; source?: string }>;
}) {
  const { status: statusParam, source: sourceParam } = await searchParams;

  const supabase = await createClient();
  // The client list rides along for the assign control on unassigned rows.
  const { data: clientList } = await supabase
    .from("clients")
    .select("id, name")
    .order("name");
  const clients = (clientList ?? []) as AssignableClient[];
  // Items come back embedded rather than in a second query. The child rows are
  // RLS-scoped through their parent (print_order_items_operator_select), so the
  // embed is subject to the same policy the header is.
  const { data } = await supabase
    .from("print_orders")
    .select(
      "id, source_app, order_id, client_id, client_name, submitter, status, ordered_at, created_at, print_order_items(name, quantity, reference, position)"
    )
    .order("created_at", { ascending: false })
    .order("position", { referencedTable: "print_order_items" });
  const orders = (data ?? []) as PrintOrderRow[];

  const activeTab =
    STATUS_TABS.find((tab) => tab.key !== null && tab.key === statusParam) ??
    STATUS_TABS[0];

  // Every source that has ever sent, derived from the rows themselves rather
  // than from inbound_sources: a source can be revoked while its orders remain,
  // and those still need to be filterable.
  const sources = [...new Set(orders.map((o) => o.source_app))].sort();
  const activeSource =
    sourceParam && sources.includes(sourceParam) ? sourceParam : null;

  // The DB already orders newest-first; the tabs only filter. Filtering here
  // rather than in the query is deliberate: the source tabs above need every row
  // to know which sources exist.
  const visible = orders.filter(
    (order) =>
      (activeTab.key === null || order.status === activeTab.key) &&
      (activeSource === null || order.source_app === activeSource)
  );

  const newCount = orders.filter((o) => o.status === "new").length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Print orders</h1>
        <p className="text-sm text-muted-foreground">
          {newCount > 0
            ? `${newCount} new ${newCount === 1 ? "order" : "orders"} to print.`
            : "What clients have asked to be printed, from every app that feeds in."}
        </p>
      </div>

      <div className="space-y-2">
        <nav className="flex flex-wrap gap-1" aria-label="Filter by status">
          {STATUS_TABS.map((tab) => (
            <Link
              key={tab.label}
              href={filterHref(tab.key, activeSource)}
              aria-current={tab.key === activeTab.key ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1 text-sm transition-colors",
                tab.key === activeTab.key
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        {sources.length > 1 ? (
          <nav className="flex flex-wrap gap-1" aria-label="Filter by source">
            <Link
              href={filterHref(activeTab.key, null)}
              aria-current={activeSource === null ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1 font-mono text-xs transition-colors",
                activeSource === null
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              all sources
            </Link>
            {sources.map((source) => (
              <Link
                key={source}
                href={filterHref(activeTab.key, source)}
                aria-current={activeSource === source ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1 font-mono text-xs transition-colors",
                  activeSource === source
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {source}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>

      {orders.length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          No print orders yet. When an app posts one to the inbound endpoint, it
          lands here.
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          {activeTab.empty || "Nothing matches that filter."}
        </p>
      ) : (
        <ul className="grid gap-2">
          {visible.map((order) => {
            const items = order.print_order_items ?? [];
            const totalQuantity = items.reduce(
              (sum, item) => sum + item.quantity,
              0
            );
            return (
              <li
                key={order.id}
                className="space-y-3 rounded-card border bg-card p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={order.status} />
                  <span className="font-mono text-xs text-muted-foreground">
                    {order.source_app}
                  </span>
                  <span className="text-sm font-medium">
                    {order.client_name}
                  </span>
                  {order.client_id ? null : (
                    <span className="text-xs text-muted-foreground">
                      (not assigned)
                    </span>
                  )}
                </div>

                {/* The job itself. A table rather than prose: John is reading
                    this to work out what to put on the press. */}
                <ul className="grid gap-1">
                  {items.map((item, index) => (
                    <li
                      key={`${order.id}-${index}`}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b pb-1 text-sm last:border-b-0 last:pb-0"
                    >
                      <span className="min-w-0 flex-1">
                        {item.name}
                        {item.reference ? (
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {item.reference}
                          </span>
                        ) : null}
                      </span>
                      <span className="tabular-nums font-medium">
                        &times;{item.quantity}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {items.length} {items.length === 1 ? "line" : "lines"}{" "}
                    &middot; {totalQuantity} total
                    {order.submitter
                      ? ` · ${order.submitter}`
                      : ""} &middot;{" "}
                    {formatDate(order.ordered_at ?? order.created_at)}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Only on unassigned rows, same reasoning as the requests
                        inbox: until an order is attached to a client it shows
                        on no client's card. */}
                    {order.client_id ? null : (
                      <AssignClient
                        id={order.id}
                        clients={clients}
                        action={assignPrintOrderToClient}
                      />
                    )}
                    {order.status === "new" ? (
                      <MoveButton
                        id={order.id}
                        status="printing"
                        label="Start printing"
                      />
                    ) : null}
                    {order.status === "printing" ? (
                      <MoveButton
                        id={order.id}
                        status="new"
                        label="Back to new"
                        variant="ghost"
                      />
                    ) : null}
                    {order.status === "done" ? (
                      <MoveButton
                        id={order.id}
                        status="printing"
                        label="Reopen"
                        variant="ghost"
                      />
                    ) : (
                      <MoveButton id={order.id} status="done" label="Done" />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
