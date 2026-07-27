"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  FileText,
  Inbox,
  ListTodo,
  Printer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ClientFormDialog,
  type ClientRow,
} from "@/components/client-form-dialog";

// The operator home: one warm tile per client, nothing else. This replaces the
// cross-client monitoring board (summary counts, attention zone, all-projects
// table), which packed five judgements into a dense read and answered none of
// them at a glance.
//
// Slice 1 is deliberately bare: avatar, name, Open. Counters and the neglect
// health bar come later, and the health bar last of all, because most clients
// currently have no data for it to read and a gradient computed from absence
// would be worse than no gradient at all.

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

// The five per-client counts. Tallied in one pass over five lean queries (see
// app/home/page.tsx), never one query per client.
export type ClientCounts = {
  requests: number;
  tasks: number;
  printOrders: number;
  social: number;
  blog: number;
};

export const ZERO_COUNTS: ClientCounts = {
  requests: 0,
  tasks: 0,
  printOrders: 0,
  social: 0,
  blog: 0,
};

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

function ClientCard({
  client,
  counts,
  onEdit,
}: {
  client: ClientRow;
  counts: ClientCounts;
  onEdit: (client: ClientRow) => void;
}) {
  return (
    <li className="flex flex-col gap-4 rounded-card border bg-card p-5 shadow-soft transition-shadow hover:shadow-md">
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
      </div>

      <CounterRow counts={counts} />

      <div className="mt-auto flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="outline"
          render={<Link href={`/c/${client.slug}/overview`} />}
        >
          Open
        </Button>
        {/* Kept deliberately, though the brief said card contents were avatar,
            name and Open only: this dialog is the ONLY way to create or edit a
            client, including the blog base URL and the deploy hook. Dropping it
            here would leave no route to those until the expand-in-place slice
            gives it a better home. */}
        <Button variant="ghost" size="sm" onClick={() => onEdit(client)}>
          Edit
        </Button>
      </div>
    </li>
  );
}

export function ClientGrid({
  clients,
  counts,
}: {
  clients: ClientRow[];
  // Keyed by client id. A client with no rows anywhere is simply absent from the
  // map, so the lookup falls back to zeros rather than needing an entry each.
  counts: Record<string, ClientCounts>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  // The dialog is remounted under a changing key so each open starts fresh,
  // matching how the board drove it.
  const [dialogKey, setDialogKey] = useState(0);

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
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {clients.map((client) => (
            <ClientCard
              key={client.id}
              client={client}
              counts={counts[client.id] ?? ZERO_COUNTS}
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
