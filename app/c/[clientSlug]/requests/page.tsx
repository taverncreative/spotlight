import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { RequestRow } from "@/components/request-row";
import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { updateRequestStatus } from "@/lib/requests/actions";
import { updatePrintOrderStatus } from "@/lib/print-orders/actions";

// The per-client Requests module, carrying print orders as a second view rather
// than as its own tab.
//
// Both are inbound work the client asked for, arriving from the same apps over
// the same endpoints, and print orders arrive rarely enough that a permanent tab
// mostly showed an empty state. They are a view switch here, not sub-tabs, so
// each keeps its own status filter: mixing "Requests / Print" with "New / In
// progress / Done" on one row would put two different questions on one axis.
//
// Rows that belong to no client live on the operator-level inboxes at /requests
// and /print-orders until they are assigned.

type RequestRow = {
  id: string;
  source_app: string;
  submitter: string | null;
  message: string;
  type: string;
  status: string;
  link: string | null;
  created_at: string;
};

type PrintOrderItem = {
  name: string;
  quantity: number;
  reference: string | null;
  position: number;
};

type PrintOrderRow = {
  id: string;
  source_app: string;
  submitter: string | null;
  status: string;
  ordered_at: string | null;
  created_at: string;
  print_order_items: PrintOrderItem[];
};

const REQUEST_TABS: { key: string | null; label: string; empty: string }[] = [
  { key: null, label: "All", empty: "" },
  { key: "new", label: "New", empty: "Nothing new from this client." },
  {
    key: "in_progress",
    label: "In progress",
    empty: "Nothing in progress for this client.",
  },
  { key: "done", label: "Done", empty: "Nothing marked done yet." },
];

const PRINT_TABS: { key: string | null; label: string; empty: string }[] = [
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
  action,
  id,
  status,
  label,
  variant = "outline",
}: {
  action: (formData: FormData) => void | Promise<void>;
  id: string;
  status: string;
  label: string;
  variant?: "outline" | "ghost";
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" variant={variant} size="sm">
        {label}
      </Button>
    </form>
  );
}

function tabClass(active: boolean): string {
  return cn(
    "rounded-md px-2.5 py-1 text-sm transition-colors",
    active
      ? "bg-accent font-medium text-foreground"
      : "text-muted-foreground hover:text-foreground"
  );
}

export default async function ClientRequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<{ status?: string; view?: string }>;
}) {
  const { clientSlug } = await params;
  const { status: statusParam, view } = await searchParams;
  const { client } = await requireClient(clientSlug);
  const isPrint = view === "print";

  const supabase = await createClient();
  const [requestsRes, ordersRes] = await Promise.all([
    supabase
      .from("client_requests")
      .select(
        "id, source_app, submitter, message, type, status, link, created_at"
      )
      .eq("client_id", client.id)
      .order("created_at", { ascending: false }),
    // Items embedded rather than fetched separately; the child rows are
    // RLS-scoped through their parent order (print_order_items_operator_select).
    supabase
      .from("print_orders")
      .select(
        "id, source_app, submitter, status, ordered_at, created_at, print_order_items(name, quantity, reference, position)"
      )
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .order("position", { referencedTable: "print_order_items" }),
  ]);

  const requests = (requestsRes.data ?? []) as RequestRow[];
  const orders = (ordersRes.data ?? []) as PrintOrderRow[];

  const tabs = isPrint ? PRINT_TABS : REQUEST_TABS;
  const activeTab =
    tabs.find((tab) => tab.key !== null && tab.key === statusParam) ?? tabs[0];

  const viewHref = (nextView: "requests" | "print") =>
    nextView === "print"
      ? `/c/${clientSlug}/requests?view=print`
      : `/c/${clientSlug}/requests`;
  const statusHref = (key: string | null) => {
    const params = new URLSearchParams();
    if (isPrint) params.set("view", "print");
    if (key) params.set("status", key);
    const query = params.toString();
    return query
      ? `/c/${clientSlug}/requests?${query}`
      : `/c/${clientSlug}/requests`;
  };

  const newRequests = requests.filter((r) => r.status === "new").length;
  const newOrders = orders.filter((o) => o.status === "new").length;

  const visibleRequests = requests.filter(
    (request) => activeTab.key === null || request.status === activeTab.key
  );
  const visibleOrders = orders.filter(
    (order) => activeTab.key === null || order.status === activeTab.key
  );

  const emptyAll = isPrint
    ? "Nothing for this client yet. Print orders arrive from other apps, and unassigned ones wait on the print queue until they are attached to a client."
    : "Nothing from this client yet. Requests arrive from other apps, and unassigned ones wait on the requests inbox until they are attached to a client.";

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Requests</h1>
        <p className="text-sm text-muted-foreground">
          What this client has asked for, from whichever app fed it in.
        </p>
      </div>

      {/* The view switch sits above the status tabs, on its own row: Requests
          against Print is a different question from New against Done, and one
          row of tabs answering both would read as a single list of filters. */}
      <div className="space-y-2">
        <nav className="flex flex-wrap gap-1" aria-label="Requests or print">
          <Link
            href={viewHref("requests")}
            aria-current={isPrint ? undefined : "page"}
            className={tabClass(!isPrint)}
          >
            Requests
            {newRequests > 0 ? (
              <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
                {newRequests}
              </span>
            ) : null}
          </Link>
          <Link
            href={viewHref("print")}
            aria-current={isPrint ? "page" : undefined}
            className={tabClass(isPrint)}
          >
            Print
            {newOrders > 0 ? (
              <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
                {newOrders}
              </span>
            ) : null}
          </Link>
        </nav>

        <nav className="flex flex-wrap gap-1" aria-label="Filter by status">
          {tabs.map((tab) => (
            <Link
              key={tab.label}
              href={statusHref(tab.key)}
              aria-current={tab.key === activeTab.key ? "page" : undefined}
              className={tabClass(tab.key === activeTab.key)}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>

      {(isPrint ? orders : requests).length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          {emptyAll}
        </p>
      ) : (isPrint ? visibleOrders : visibleRequests).length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          {activeTab.empty || "Nothing matches that filter."}
        </p>
      ) : isPrint ? (
        <ul className="grid gap-2">
          {visibleOrders.map((order) => {
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
                    {order.status === "new" ? (
                      <MoveButton
                        action={updatePrintOrderStatus}
                        id={order.id}
                        status="printing"
                        label="Start printing"
                      />
                    ) : null}
                    {order.status === "printing" ? (
                      <MoveButton
                        action={updatePrintOrderStatus}
                        id={order.id}
                        status="new"
                        label="Back to new"
                        variant="ghost"
                      />
                    ) : null}
                    {order.status === "done" ? (
                      <MoveButton
                        action={updatePrintOrderStatus}
                        id={order.id}
                        status="printing"
                        label="Reopen"
                        variant="ghost"
                      />
                    ) : (
                      <MoveButton
                        action={updatePrintOrderStatus}
                        id={order.id}
                        status="done"
                        label="Done"
                      />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="grid gap-2">
          {visibleRequests.map((request) => (
            <RequestRow
              key={request.id}
              status={request.status}
              sourceApp={request.source_app}
              type={request.type}
              submitter={request.submitter}
              createdAt={request.created_at}
              message={request.message}
              quickActions={
                request.status !== "done" ? (
                  <MoveButton
                    action={updateRequestStatus}
                    id={request.id}
                    status="done"
                    label="Done"
                  />
                ) : null
              }
              actions={
                <>
                  {request.link ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      render={
                        <a
                          href={request.link}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      }
                    >
                      <ExternalLink />
                      Source
                    </Button>
                  ) : null}
                  {request.status === "new" ? (
                    <MoveButton
                      action={updateRequestStatus}
                      id={request.id}
                      status="in_progress"
                      label="Start"
                    />
                  ) : null}
                  {request.status === "in_progress" ? (
                    <MoveButton
                      action={updateRequestStatus}
                      id={request.id}
                      status="new"
                      label="Back to new"
                      variant="ghost"
                    />
                  ) : null}
                  {request.status === "done" ? (
                    <MoveButton
                      action={updateRequestStatus}
                      id={request.id}
                      status="in_progress"
                      label="Reopen"
                      variant="ghost"
                    />
                  ) : null}
                </>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
