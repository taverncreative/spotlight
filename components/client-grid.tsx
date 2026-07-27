"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  ChevronDown,
  FileText,
  Inbox,
  ListTodo,
  Printer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ClientFormDialog,
  type ClientRow,
} from "@/components/client-form-dialog";
import {
  EMPTY_CARD_DATA,
  type ClientCardData,
  type ClientCounts,
} from "@/lib/clients/counts";

// The operator home: one warm tile per client, expanding in place to show what
// its counters summarise. This replaced the cross-client monitoring board, which
// packed five judgements into a dense read and answered none of them at a
// glance.
//
// ClientCounts, ClientCardData and EMPTY_CARD_DATA live in lib/clients/counts.ts,
// NOT here. They were defined in this file once, and app/home/page.tsx imported
// the zero constant across the server/client boundary, where Next replaced it
// with a client reference and every count silently became NaN. Shared values
// belong in a plain module; keep them out of this one.

// How many rows each section shows before it stops. The expansion is a glance at
// what is waiting, not the module: anything past this is one click away in the
// client's own tab, and the "+N more" line says so rather than hiding it.
const MAX_TASKS = 4;
const MAX_SOCIAL = 4;
const MAX_BLOG = 3;

// Up to two letters from the client's name, for the avatar. First letters of the
// first two words, or the first two letters when there is only one word. Runs of
// non-alphanumerics are separators, so "Safe Lee Inspection & Consultancy Ltd"
// gives SL rather than picking up the ampersand.
export function initialsFrom(name: string): string {
  const words = name
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 2);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function formatDate(value: string | null): string {
  if (!value) return "No date";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

// Icon, label and accessor per counter. The label is what a screen reader and a
// hover tooltip get; the icon alone carries it visually, because five words on a
// card is a paragraph and this has to be readable at a glance.
const COUNTERS: {
  key: keyof ClientCounts;
  label: string;
  Icon: typeof Inbox;
}[] = [
  { key: "requests", label: "open requests", Icon: Inbox },
  { key: "tasks", label: "open tasks", Icon: ListTodo },
  { key: "printOrders", label: "new print orders", Icon: Printer },
  { key: "social", label: "scheduled social posts", Icon: CalendarClock },
  { key: "blog", label: "published blog posts", Icon: FileText },
];

// Zeros are omitted rather than rendered, so a card shows only what is actually
// there. A client with nothing open shows no counter row at all, which is the
// point: a row of noughts reads as busywork and hides the cards that matter.
function CounterRow({ counts }: { counts: ClientCounts }) {
  const shown = COUNTERS.filter((counter) => counts[counter.key] > 0);
  if (shown.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {shown.map(({ key, label, Icon }) => (
        <span
          key={key}
          title={`${counts[key]} ${label}`}
          className="inline-flex items-center gap-1 text-muted-foreground"
        >
          <Icon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="text-xs font-medium tabular-nums text-foreground">
            {counts[key]}
          </span>
          <span className="sr-only">{label}</span>
        </span>
      ))}
    </div>
  );
}

// One labelled group in the expansion. Renders nothing when it has no rows, so
// a client with only blog posts shows only a blog section.
function DetailSection({
  label,
  total,
  shown,
  children,
}: {
  label: string;
  total: number;
  shown: number;
  children: React.ReactNode;
}) {
  if (total === 0) return null;
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
      <ul className="space-y-1">{children}</ul>
      {total > shown ? (
        <p className="text-xs text-muted-foreground">
          +{total - shown} more
        </p>
      ) : null}
    </section>
  );
}

// One row: what it is on the left, when it is on the right. The date column is
// fixed and tabular so the dates line up down the card rather than ragging along
// after titles of different lengths.
function DetailRow({ text, date }: { text: string; date: string | null }) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-xs">
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {formatDate(date)}
      </span>
    </li>
  );
}

function ClientCard({
  client,
  data,
  expanded,
  onToggle,
  onEdit,
}: {
  client: ClientRow;
  data: ClientCardData;
  expanded: boolean;
  onToggle: (id: string) => void;
  onEdit: (client: ClientRow) => void;
}) {
  const panelId = useId();
  const hasDetail =
    data.tasks.length > 0 || data.social.length > 0 || data.blog.length > 0;

  return (
    <li className="flex flex-col rounded-card border bg-card shadow-soft transition-shadow hover:shadow-md">
      {/* The whole head toggles. Open and Edit sit OUTSIDE it, because a button
          inside a button is invalid and unreachable by keyboard. */}
      <button
        type="button"
        onClick={() => onToggle(client.id)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex flex-col gap-3 rounded-t-card p-5 pb-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <div className="flex items-start gap-3">
          {/* Initials stand in for a logo. Logo storage is a later slice; the
              avatar box is sized so swapping an <img> in changes nothing else. */}
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-control bg-brand/10 text-sm font-semibold tracking-wide text-brand"
          >
            {initialsFrom(client.name)}
          </span>
          <p className="min-w-0 flex-1 pt-1 text-sm font-medium leading-snug">
            {client.name}
          </p>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
              expanded && "rotate-180"
            )}
          />
        </div>
        <CounterRow counts={data.counts} />
      </button>

      {/* 0fr -> 1fr on a grid row animates to the content's natural height, which
          a plain max-height cannot do without guessing a number. The child owns
          overflow-hidden so the rows clip while collapsed rather than bleeding
          through. This is what keeps the grid from jumping: the row grows over
          200ms instead of snapping. */}
      <div
        id={panelId}
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-3 border-t px-5 py-4">
            {hasDetail ? (
              <>
                <DetailSection
                  label="Open tasks"
                  total={data.tasks.length}
                  shown={Math.min(data.tasks.length, MAX_TASKS)}
                >
                  {data.tasks.slice(0, MAX_TASKS).map((task) => (
                    <DetailRow
                      key={task.id}
                      text={task.title}
                      date={task.due_date}
                    />
                  ))}
                </DetailSection>

                <DetailSection
                  label="Scheduled social"
                  total={data.social.length}
                  shown={Math.min(data.social.length, MAX_SOCIAL)}
                >
                  {data.social.slice(0, MAX_SOCIAL).map((post) => (
                    <DetailRow
                      key={post.id}
                      text={post.caption || "No caption"}
                      date={post.scheduled_at}
                    />
                  ))}
                </DetailSection>

                <DetailSection
                  label="Recent posts"
                  total={data.blog.length}
                  shown={Math.min(data.blog.length, MAX_BLOG)}
                >
                  {data.blog.slice(0, MAX_BLOG).map((post) => (
                    <DetailRow
                      key={post.id}
                      text={post.title}
                      date={post.published_at}
                    />
                  ))}
                </DetailSection>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nothing scheduled or outstanding.
              </p>
            )}

            <div className="flex justify-end pt-1">
              <Button variant="ghost" size="sm" onClick={() => onEdit(client)}>
                Edit client
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-auto flex items-center px-5 pb-5 pt-3">
        <Button
          size="sm"
          variant="outline"
          render={<Link href={`/c/${client.slug}/overview`} />}
        >
          Open
        </Button>
      </div>
    </li>
  );
}

export function ClientGrid({
  clients,
  cards,
}: {
  clients: ClientRow[];
  // Keyed by client id. A client with no rows anywhere is simply absent from the
  // map, so the lookup falls back to empty rather than needing an entry each.
  cards: Record<string, ClientCardData>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  // The dialog is remounted under a changing key so each open starts fresh.
  const [dialogKey, setDialogKey] = useState(0);
  // One card at a time. Holding the id rather than a per-card boolean is what
  // makes that true by construction: opening one cannot leave another open.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggle(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }
  function openAdd() {
    setEditing(null);
    setDialogKey((key) => key + 1);
    setDialogOpen(true);
  }
  function openEdit(client: ClientRow) {
    setEditing(client);
    setDialogKey((key) => key + 1);
    setDialogOpen(true);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-lg font-medium">Clients</h1>
          <p className="text-sm text-muted-foreground">
            Everyone you look after.
          </p>
        </div>
        <Button onClick={openAdd}>Add client</Button>
      </div>

      {clients.length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          No clients yet. Add your first client to get started.
        </p>
      ) : (
        // items-start so an expanding card grows on its own rather than
        // stretching every tile in its row to match.
        <ul className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {clients.map((client) => (
            <ClientCard
              key={client.id}
              client={client}
              data={cards[client.id] ?? EMPTY_CARD_DATA}
              expanded={expandedId === client.id}
              onToggle={toggle}
              onEdit={openEdit}
            />
          ))}
        </ul>
      )}

      <ClientFormDialog
        key={dialogKey}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        client={editing}
      />
    </div>
  );
}
