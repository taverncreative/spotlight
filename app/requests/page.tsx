import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import { createClient } from "@/lib/supabase/server";
import { updateRequestStatus } from "@/lib/requests/actions";

type RequestRow = {
  id: string;
  source_app: string;
  client_id: string | null;
  client_name: string;
  submitter: string | null;
  message: string;
  type: string;
  status: string;
  link: string | null;
  created_at: string;
};

// Status tabs, the same link-based pattern the blog and social lists use. "empty"
// is the message when the tab filters everything out.
const STATUS_TABS: {
  key: string | null;
  label: string;
  empty: string;
}[] = [
  { key: null, label: "All", empty: "" },
  { key: "new", label: "New", empty: "Nothing new. You are on top of it." },
  { key: "in_progress", label: "In progress", empty: "Nothing in progress." },
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
function filterHref(
  status: string | null,
  source: string | null
): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (source) params.set("source", source);
  const query = params.toString();
  return query ? `/requests?${query}` : "/requests";
}

// One move button. A plain form per action, mirroring the blog card's
// publish/unpublish forms: no client component needed for a status change.
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

// The cross-source triage inbox: every inbound request in one list, newest
// first, whichever app sent it and whether or not it names a client we manage.
// Operator-level by nature, so it sits at the top level rather than under a
// client (a request with client_id null belongs to no client at all).
//
// RLS (client_requests_operator_select) scopes the read; the layout gates auth.
export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; source?: string }>;
}) {
  const { status: statusParam, source: sourceParam } = await searchParams;

  const supabase = await createClient();
  const { data } = await supabase
    .from("client_requests")
    .select(
      "id, source_app, client_id, client_name, submitter, message, type, status, link, created_at"
    )
    .order("created_at", { ascending: false });
  const requests = (data ?? []) as RequestRow[];

  const activeTab =
    STATUS_TABS.find((tab) => tab.key !== null && tab.key === statusParam) ??
    STATUS_TABS[0];

  // Every source that has ever sent, derived from the rows themselves rather
  // than from inbound_sources: a source can be revoked while its requests remain,
  // and those still need to be filterable.
  const sources = [...new Set(requests.map((r) => r.source_app))].sort();
  const activeSource = sourceParam && sources.includes(sourceParam) ? sourceParam : null;

  // The DB already orders newest-first; the tabs only filter. Filtering here
  // rather than in the query is deliberate: the source tabs above need every row
  // to know which sources exist.
  const visible = requests.filter(
    (request) =>
      (activeTab.key === null || request.status === activeTab.key) &&
      (activeSource === null || request.source_app === activeSource)
  );

  const newCount = requests.filter((r) => r.status === "new").length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Requests</h1>
        <p className="text-sm text-muted-foreground">
          {newCount > 0
            ? `${newCount} new ${newCount === 1 ? "request" : "requests"} waiting on you.`
            : "What clients have asked for, from every app that feeds in."}
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

      {requests.length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          No requests yet. When an app posts one to the inbound endpoint, it lands
          here.
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
                <span className="text-sm font-medium">
                  {request.client_name}
                </span>
                {request.client_id ? null : (
                  <span className="text-xs text-muted-foreground">
                    (not a managed client)
                  </span>
                )}
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
                      Source
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
