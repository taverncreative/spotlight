"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
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
import { SERVICE_LABELS, type HealthResult } from "@/lib/clients/health";
import {
  EMPTY_CARD_DATA,
  type ClientCardData,
  type ClientCounts,
  type UnassignedCounts,
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
const MAX_REQUESTS = 3;
const MAX_TASKS = 4;
const MAX_PRINT = 3;
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

  // The container is rendered even when every counter is zero, and min-h-5
  // reserves one line of it. That is what makes collapsed cards uniform without
  // going back to items-stretch: the row's SPACE is constant, its CONTENTS are
  // still hidden when zero. The avatar already fixes the header row at 44px
  // whether the name runs to one line or two, so this was the only thing left
  // making one card taller than its neighbour.
  return (
    <div className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1.5">
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

// Score to colour, continuously. Two segments through the palette's existing
// warm ramp: danger at 0, warn at the midpoint, ok at 1. No bands, so a client
// at 0.62 and one at 0.64 differ by a shade rather than jumping a category.
//
// color-mix(in oklch, ...) is already the house technique for the status
// surfaces, and interpolating in oklch keeps lightness even across the ramp
// rather than dipping through mud the way sRGB does. It also means the bar
// adapts to light and dark for free, because the tokens themselves differ.
function healthColour(score: number): string {
  if (score >= 0.5) {
    const mix = Math.round((score - 0.5) * 200);
    return `color-mix(in oklch, var(--color-status-ok) ${mix}%, var(--color-status-warn))`;
  }
  const mix = Math.round(score * 200);
  return `color-mix(in oklch, var(--color-status-warn) ${mix}%, var(--color-status-danger))`;
}

// The health bar, with the score in words beside it.
//
// COLOUR IS NOT THE ONLY CARRIER, deliberately. A gold-to-red ramp is precisely
// the axis red-green colour blindness flattens, so the percentage sits next to
// the bar and the per-service breakdown is in the tooltip and the accessible
// name. Someone who cannot separate the hues loses nothing.
function HealthBar({
  health,
  onEdit,
}: {
  health: HealthResult;
  onEdit: () => void;
}) {
  // No applicable service. Absence must LOOK like absence: a grey bar at zero
  // reads as a judgement, and this client has not been judged.
  if (health.score === null) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
        className="flex min-h-5 items-center text-left text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        No services set
      </button>
    );
  }

  const percent = Math.round(health.score * 100);
  const breakdown = health.parts
    .map((part) => `${SERVICE_LABELS[part.service]} ${Math.round(part.value * 100)}%`)
    .join(", ");

  return (
    <div
      className="flex min-h-5 items-center gap-2"
      title={breakdown ? `Health ${percent}% — ${breakdown}` : undefined}
    >
      <div
        role="meter"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={
          breakdown ? `Health ${percent}%. ${breakdown}` : `Health ${percent}%`
        }
        className="h-1.5 flex-1 overflow-hidden rounded-pill bg-secondary"
      >
        <div
          className="h-full rounded-pill transition-[width] duration-300 motion-reduce:transition-none"
          style={{
            width: `${percent}%`,
            backgroundColor: healthColour(health.score),
          }}
        />
      </div>
      <span
        aria-hidden="true"
        className="shrink-0 text-xs tabular-nums text-muted-foreground"
      >
        {percent}%
      </span>
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
//
// overdue tints the date rather than the whole row: the task is not a problem,
// its date is. The flag is computed on the server (see app/home/page.tsx),
// because reading the clock during a client render answers differently on each
// side of hydration.
function DetailRow({
  prefix,
  text,
  date,
  overdue = false,
}: {
  // A muted lead-in: who sent a request, how many of a thing to print. It sits
  // inside the same truncating line so a long message still gets cut cleanly
  // rather than pushing the date off the card.
  prefix?: string | null;
  text: string;
  date: string | null;
  overdue?: boolean;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-xs">
      <span className="min-w-0 flex-1 truncate">
        {prefix ? (
          <span className="text-muted-foreground">{prefix} </span>
        ) : null}
        {text}
      </span>
      <span
        title={overdue ? "Overdue" : undefined}
        className={cn(
          "shrink-0 tabular-nums",
          overdue ? "font-medium text-status-danger" : "text-muted-foreground"
        )}
      >
        {formatDate(date)}
        {overdue ? <span className="sr-only"> (overdue)</span> : null}
      </span>
    </li>
  );
}

// Inbound rows that belong to no client. A per-client grid cannot show them at
// all, and today that is every request and every print order, so without this
// strip they are invisible rather than merely unassigned. It renders only when
// there is something to say.
function UnassignedStrip({ unassigned }: { unassigned: UnassignedCounts }) {
  const parts: { href: string; label: string }[] = [];
  if (unassigned.requests > 0) {
    parts.push({
      href: "/requests",
      label: `${unassigned.requests} request${unassigned.requests === 1 ? "" : "s"}`,
    });
  }
  if (unassigned.printOrders > 0) {
    parts.push({
      href: "/print-orders",
      label: `${unassigned.printOrders} print order${unassigned.printOrders === 1 ? "" : "s"}`,
    });
  }
  if (parts.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-card border border-dashed bg-card/50 px-4 py-3 text-sm">
      <AlertCircle
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="text-muted-foreground">
        Not assigned to a client yet:
      </span>
      {parts.map((part, index) => (
        <span key={part.href} className="text-muted-foreground">
          <Link
            href={part.href}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {part.label}
          </Link>
          {index < parts.length - 1 ? "," : ""}
        </span>
      ))}
    </div>
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
    data.requests.length > 0 ||
    data.tasks.length > 0 ||
    data.printOrders.length > 0 ||
    data.social.length > 0 ||
    data.blog.length > 0;

  // The panel's open height, measured from the content rather than guessed. A
  // ResizeObserver keeps it right if the content reflows (a long client name
  // wrapping, a window resize changing the column width), so the panel does not
  // end up clipped or padded after the first measurement.
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);
  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setContentHeight(element.offsetHeight);
    });
    observer.observe(element);
    setContentHeight(element.offsetHeight);
    return () => observer.disconnect();
  }, []);

  return (
    // The WHOLE card toggles, because the whole card looks like it should. The
    // click lives on the li rather than on a role="button" wrapper: putting a
    // link and a button inside an element that claims to be a button is the
    // thing screen readers cannot make sense of. So the li stays a plain
    // container with a mouse affordance, and the chevron below is a real button
    // carrying the accessible name, the expanded state and the keyboard path.
    // Nested controls stop propagation so they act instead of toggling.
    <li
      onClick={() => onToggle(client.id)}
      className="flex cursor-pointer flex-col rounded-card border bg-card shadow-soft transition-shadow hover:shadow-md"
    >
      <div className="flex flex-col gap-3 p-5 pb-3">
        <div className="flex items-start gap-3">
          {/* Initials stand in for a logo. Logo storage is a later slice; the
              avatar box is sized so swapping an <img> in changes nothing else. */}
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-control bg-brand/10 text-sm font-semibold tracking-wide text-brand"
          >
            {initialsFrom(client.name)}
          </span>
          {/* Clamped to two lines so a long name cannot push past the avatar's
              44px and make one card taller than the rest. "Safe Lee Inspection
              & Consultancy Ltd" is the one that wraps today. */}
          <p className="line-clamp-2 min-w-0 flex-1 pt-1 text-sm font-medium leading-snug">
            {client.name}
          </p>
          {/* The real control: this is what a keyboard reaches and what an
              assistive technology reads, even though a mouse can hit anywhere. */}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(client.id);
            }}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={`${expanded ? "Hide" : "Show"} detail for ${client.name}`}
            className="-m-1 rounded-control p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                expanded && "rotate-180"
              )}
            />
          </button>
        </div>
        <CounterRow counts={data.counts} />
        {/* Below the counters: the counters say what is waiting, the bar says
            how that adds up. Both are one line, so cards stay uniform whichever
            state they are in. */}
        <HealthBar health={data.health} onEdit={() => onEdit(client)} />
      </div>

      {/* MEASURED height, not a grid 0fr -> 1fr trick.
          That trick is what shipped in slice 3 and it never worked here: the
          class switched correctly and aria-expanded flipped, but
          grid-template-rows: 1fr resolved to 0px every time, so the panel stayed
          shut and clicking looked like it did nothing. 1fr needs definite free
          space to resolve against; this panel has none, being a content-sized
          box inside a content-sized card inside an items-start grid.
          A measured pixel height has nothing to resolve against and cannot fail
          that way. It animates just as smoothly, and unlike a max-height guess
          it eases over the real distance rather than a made-up one. */}
      <div
        id={panelId}
        style={{ height: expanded ? contentHeight : 0 }}
        className="overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none"
      >
        <div ref={contentRef}>
          <div className="space-y-3 border-t px-5 py-4">
            {hasDetail ? (
              <>
                {/* Section order matches COUNTERS, so a chip on the face and
                    its section below appear in the same sequence. */}
                <DetailSection
                  label="Open requests"
                  total={data.requests.length}
                  shown={Math.min(data.requests.length, MAX_REQUESTS)}
                >
                  {data.requests.slice(0, MAX_REQUESTS).map((request) => (
                    <DetailRow
                      key={request.id}
                      prefix={request.submitter}
                      text={request.message}
                      date={request.created_at}
                    />
                  ))}
                </DetailSection>

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
                      overdue={task.overdue}
                    />
                  ))}
                </DetailSection>

                <DetailSection
                  label="New print orders"
                  total={data.printOrders.length}
                  shown={Math.min(data.printOrders.length, MAX_PRINT)}
                >
                  {data.printOrders.slice(0, MAX_PRINT).map((order) => (
                    <DetailRow
                      key={order.id}
                      prefix={order.quantity > 0 ? `${order.quantity}x` : null}
                      text={
                        order.extraLines > 0
                          ? `${order.summary} +${order.extraLines} more`
                          : order.summary
                      }
                      date={order.ordered_at}
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
              <Button
                variant="ghost"
                size="sm"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(client);
                }}
              >
                Edit client
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-auto flex items-center px-5 pb-5 pt-3">
        {/* Stops propagation so following the link does not also toggle the card
            open behind the navigation. */}
        <Button
          size="sm"
          variant="outline"
          onClick={(event) => event.stopPropagation()}
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
  unassigned,
}: {
  clients: ClientRow[];
  // Keyed by client id. A client with no rows anywhere is simply absent from the
  // map, so the lookup falls back to empty rather than needing an entry each.
  cards: Record<string, ClientCardData>;
  unassigned: UnassignedCounts;
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

      <UnassignedStrip unassigned={unassigned} />

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
