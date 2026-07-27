import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { updateRequestStatus } from "@/lib/requests/actions";

// The per-client Requests module: what this client has asked for, from whichever
// app fed it in.
//
// This used to be an operator-level page at /requests. An inbound request is FOR
// someone, so it belongs in their module bar. /requests survives as the
// unassigned inbox: rows that named a client we do not manage, or named none,
// and so belong on nobody's tab until they are assigned.
//
// No source filter here and no assign control. A request on this page is already
// attached to this client, and one client rarely has enough senders for the
// filter to earn its space.

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

const STATUS_TABS: { key: string | null; label: string; empty: string }[] = [
  { key: null, label: "All", empty: "" },
  { key: "new", label: "New", empty: "Nothing new from this client." },
  {
    key: "in_progress",
    label: "In progress",
    empty: "Nothing in progress for this client.",
  },
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
    <form action={updateRequestStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" variant={variant} size="sm">
        {label}
      </Button>
    </form>
  );
}

export default async function ClientRequestsPage({
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
  const { data } = await supabase
    .from("client_requests")
    .select(
      "id, source_app, submitter, message, type, status, link, created_at"
    )
    .eq("client_id", client.id)
    .order("created_at", { ascending: false });
  const requests = (data ?? []) as RequestRow[];

  const activeTab =
    STATUS_TABS.find((tab) => tab.key !== null && tab.key === statusParam) ??
    STATUS_TABS[0];

  const visible = requests.filter(
    (request) => activeTab.key === null || request.status === activeTab.key
  );
  const newCount = requests.filter((r) => r.status === "new").length;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Requests</h1>
        <p className="text-sm text-muted-foreground">
          {newCount > 0
            ? `${newCount} new ${newCount === 1 ? "request" : "requests"} from this client.`
            : "What this client has asked for."}
        </p>
      </div>

      <nav className="flex flex-wrap gap-1" aria-label="Filter by status">
        {STATUS_TABS.map((tab) => (
          <a
            key={tab.label}
            href={
              tab.key === null
                ? `/c/${clientSlug}/requests`
                : `/c/${clientSlug}/requests?status=${tab.key}`
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

      {requests.length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          Nothing from this client yet. Requests arrive from other apps, and
          unassigned ones wait on the requests inbox until they are attached to
          a client.
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          {activeTab.empty || "Nothing matches that filter."}
        </p>
      ) : (
        <ul className="grid gap-2">
          {visible.map((request) => (
            <li
              key={request.id}
              className="space-y-2 rounded-card border bg-card p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={request.status} />
                <span className="font-mono text-xs text-muted-foreground">
                  {request.source_app}
                </span>
                <Badge variant="outline">{request.type}</Badge>
              </div>

              <p className="text-sm whitespace-pre-wrap">{request.message}</p>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {request.submitter ? `${request.submitter} · ` : ""}
                  {formatDate(request.created_at)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
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
                    </Button>
                  ) : null}
                  {request.status === "new" ? (
                    <MoveButton
                      id={request.id}
                      status="in_progress"
                      label="Start"
                    />
                  ) : null}
                  {request.status === "in_progress" ? (
                    <MoveButton
                      id={request.id}
                      status="new"
                      label="Back to new"
                      variant="ghost"
                    />
                  ) : null}
                  {request.status === "done" ? (
                    <MoveButton
                      id={request.id}
                      status="in_progress"
                      label="Reopen"
                      variant="ghost"
                    />
                  ) : (
                    <MoveButton id={request.id} status="done" label="Done" />
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
