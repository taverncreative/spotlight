import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RequestRow } from "@/components/request-row";
import { RequestDeleteButton } from "@/components/request-delete-button";
import { RequestsBulkDelete } from "@/components/requests-bulk-delete";
import { RememberSourceDefault } from "@/components/remember-source-default";
import { createClient } from "@/lib/supabase/server";
import {
  assignRequestToClient,
  updateRequestStatus,
} from "@/lib/requests/actions";
import {
  AssignClient,
  type AssignableClient,
} from "@/components/assign-client";

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
  // "All" DELIBERATELY EXCLUDES ARCHIVED, and that is the whole point of the
  // archive. A default view that still showed archived rows would mean filing
  // something achieved nothing but a change of colour. Archived is reachable
  // only through its own tab, which is what makes it a place to put things.
  { key: null, label: "All", empty: "" },
  { key: "new", label: "New", empty: "Nothing new. You are on top of it." },
  { key: "in_progress", label: "In progress", empty: "Nothing in progress." },
  { key: "done", label: "Done", empty: "Nothing marked done yet." },
  { key: "archived", label: "Archived", empty: "Nothing archived." },
];

// A filter link that keeps whichever other filter is already set, so status and
// source compose instead of clobbering each other.
function filterHref(status: string | null, source: string | null): string {
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
  searchParams: Promise<{
    status?: string;
    source?: string;
    // Carried back by assignRequestToClient when the source it came from has no
    // default client yet, so the page can offer to remember.
    remember?: string;
    client?: string;
  }>;
}) {
  const {
    status: statusParam,
    source: sourceParam,
    remember: rememberParam,
    client: rememberClientId,
  } = await searchParams;

  const supabase = await createClient();
  // The client list rides along for the assign control on unassigned rows.
  const [{ data }, { count: assignedCount }, { data: clientList }] =
    await Promise.all([
      supabase
        .from("client_requests")
        .select(
          "id, source_app, client_id, client_name, submitter, message, type, status, link, created_at"
        )
        // UNASSIGNED ONLY. Requests that belong to a client now live on that
        // client's Requests tab; what is left here is the inbox for rows that
        // named a client we do not manage, or named none, and so appear on
        // nobody's tab until they are assigned below.
        .is("client_id", null)
        .order("created_at", { ascending: false }),
      // Count only, and of the rows this page deliberately does NOT list: the
      // bulk-delete dialog states what is protected, and "assigned" is exactly
      // the set 0087 refuses to delete.
      supabase
        .from("client_requests")
        .select("id", { count: "exact", head: true })
        .not("client_id", "is", null),
      supabase
        .from("clients")
        .select("id, name")
        .neq("status", "archived")
        .order("name"),
    ]);
  const requests = (data ?? []) as RequestRow[];
  const clients = (clientList ?? []) as AssignableClient[];

  const activeTab =
    STATUS_TABS.find((tab) => tab.key !== null && tab.key === statusParam) ??
    STATUS_TABS[0];

  // Every source that has ever sent, derived from the rows themselves rather
  // than from inbound_sources: a source can be revoked while its requests remain,
  // and those still need to be filterable.
  const sources = [
    ...new Set(
      requests
        .filter((r) => activeTab.key === "archived" || r.status !== "archived")
        .map((r) => r.source_app)
    ),
  ].sort();
  const activeSource =
    sourceParam && sources.includes(sourceParam) ? sourceParam : null;

  // The DB already orders newest-first; the tabs only filter. Filtering here
  // rather than in the query is deliberate: the source tabs above need every row
  // to know which sources exist.
  const visible = requests.filter(
    (request) =>
      (activeTab.key === null
        ? request.status !== "archived"
        : request.status === activeTab.key) &&
      (activeSource === null || request.source_app === activeSource)
  );

  const newCount = requests.filter((r) => r.status === "new").length;

  // The offer, resolved server-side. The client is read through RLS from its id
  // rather than taken from the URL, so the banner can only ever name a client
  // this operator owns -- and a stale or forged param simply shows nothing.
  const offerClient =
    rememberParam && rememberClientId
      ? clients.find((client) => client.id === rememberClientId)
      : undefined;
  const rememberSource = offerClient
    ? {
        sourceApp: rememberParam!,
        clientId: offerClient.id,
        clientName: offerClient.name,
      }
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">
            Unassigned requests
          </h1>
          <p className="text-sm text-muted-foreground">
            {newCount > 0
              ? `${newCount} new ${newCount === 1 ? "request" : "requests"} waiting on you.`
              : "What clients have asked for, from every app that feeds in."}
          </p>
        </div>
        {/* Operates on the rendered list, so whatever the filters are showing is
            exactly what goes. Every row on this page is unassigned by
            definition, which is the set 0087 permits deleting. */}
        <RequestsBulkDelete
          ids={visible.map((request) => request.id)}
          assignedCount={assignedCount ?? 0}
        />
      </div>

      {/* Shown only straight after an assignment, and only for a source that
          does not already know where its requests go. The client name is looked
          up rather than trusted from the query string, so a hand-edited URL
          cannot put another operator's client name on the offer. */}
      {rememberSource ? (
        <RememberSourceDefault
          sourceApp={rememberSource.sourceApp}
          clientId={rememberSource.clientId}
          clientName={rememberSource.clientName}
        />
      ) : null}

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
          No requests yet. When an app posts one to the inbound endpoint, it
          lands here.
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          {activeTab.empty || "Nothing matches that filter."}
        </p>
      ) : (
        <ul className="grid gap-2">
          {visible.map((request) => (
            <RequestRow
              key={request.id}
              status={request.status}
              sourceApp={request.source_app}
              type={request.type}
              clientName={request.client_name}
              submitter={request.submitter}
              createdAt={request.created_at}
              message={request.message}
              // Done is the one action worth reaching without opening the row:
              // triaging is mostly deciding that something is dealt with.
              quickActions={
                // Not on an archived row: Done on the collapsed line would
                // quietly pull it back out of the archive, which is the one
                // thing filing it was meant to prevent.
                request.status === "new" || request.status === "in_progress" ? (
                  <MoveButton id={request.id} status="done" label="Done" />
                ) : null
              }
              actions={
                <>
                  {/* Every row on this page is unassigned by definition, so
                      the control is unconditional. Assigning moves the request
                      onto that client's Requests tab and off this page. */}
                  <AssignClient
                    id={request.id}
                    clients={clients}
                    action={assignRequestToClient}
                  />
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
                  ) : null}
                  {/* Archive is a filing action, not a lifecycle step, so it is
                      offered on anything that is not already filed rather than
                      only on done. Restore goes back to done rather than to
                      new: it was dealt with before it was filed. */}
                  {request.status === "archived" ? (
                    <MoveButton
                      id={request.id}
                      status="done"
                      label="Restore"
                      variant="ghost"
                    />
                  ) : (
                    <MoveButton
                      id={request.id}
                      status="archived"
                      label="Archive"
                      variant="ghost"
                    />
                  )}
                  {/* Last, and only here. Every row on this page is unassigned
                      by definition, which is exactly the set 0087 allows to be
                      deleted. It never appears on the collapsed line: nothing
                      destructive should be one click from a list you skim. */}
                  <RequestDeleteButton
                    requestId={request.id}
                    summary={request.message.split("\n")[0]?.trim() ?? ""}
                  />
                </>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
