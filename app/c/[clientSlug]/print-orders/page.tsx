import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { updatePrintOrderStatus } from "@/lib/print-orders/actions";

// The per-client Print module: what this client has asked to be printed.
//
// This used to be an operator-level page at /print-orders. A print order is FOR
// someone, so it belongs in their module bar. /print-orders survives as the
// unassigned queue: orders that named a client we do not manage, or named none.

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
  submitter: string | null;
  status: string;
  ordered_at: string | null;
  created_at: string;
  print_order_items: PrintOrderItem[];
};

const STATUS_TABS: { key: string | null; label: string; empty: string }[] = [
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

export default async function ClientPrintOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { clientSlug } = await params;
  const { status: statusParam } = await searchParams;
  const { client } = await requireClient(clientSlug);

  const supabase = await createClient();
  // Items embedded rather than fetched separately; the child rows are RLS-scoped
  // through their parent order (print_order_items_operator_select, 0058).
  const { data } = await supabase
    .from("print_orders")
    .select(
      "id, source_app, order_id, submitter, status, ordered_at, created_at, print_order_items(name, quantity, reference, position)"
    )
    .eq("client_id", client.id)
    .order("created_at", { ascending: false })
    .order("position", { referencedTable: "print_order_items" });
  const orders = (data ?? []) as PrintOrderRow[];

  const activeTab =
    STATUS_TABS.find((tab) => tab.key !== null && tab.key === statusParam) ??
    STATUS_TABS[0];

  const visible = orders.filter(
    (order) => activeTab.key === null || order.status === activeTab.key
  );
  const newCount = orders.filter((o) => o.status === "new").length;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Print</h1>
        <p className="text-sm text-muted-foreground">
          {newCount > 0
            ? `${newCount} new ${newCount === 1 ? "order" : "orders"} to print.`
            : "What this client has asked to be printed."}
        </p>
      </div>

      <nav className="flex flex-wrap gap-1" aria-label="Filter by status">
        {STATUS_TABS.map((tab) => (
          <a
            key={tab.label}
            href={
              tab.key === null
                ? `/c/${clientSlug}/print-orders`
                : `/c/${clientSlug}/print-orders?status=${tab.key}`
            }
            aria-current={tab.key === activeTab.key ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1 text-sm transition-colors",
              tab.key === activeTab.key
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </a>
        ))}
      </nav>

      {orders.length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          Nothing for this client yet. Print orders arrive from other apps, and
          unassigned ones wait on the print queue until they are attached to a
          client.
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
                </div>

                {/* A table rather than prose: this is read to work out what to
                    put on the press. */}
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
                    {order.submitter ? ` · ${order.submitter}` : ""} &middot;{" "}
                    {formatDate(order.ordered_at ?? order.created_at)}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
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
