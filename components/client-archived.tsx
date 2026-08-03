"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { fieldInputClass } from "@/components/form-field";
import { initialsFrom } from "@/components/client-grid";
import { deleteClient, restoreClient } from "@/lib/clients/settings-actions";
import type { ArchivedClient, DeletionImpact } from "@/app/home/page";

// Archived clients, and the only surface in the app that still knows they exist.
//
// requireClient 404s them, so their module pages are gone; the selector and the
// assign dropdowns drop them too. Restoring and deleting therefore have to live
// here, not on a settings tab that can no longer be reached.
//
// Collapsed by default: this is a drawer you open when you need it, not a second
// roster competing with the live one.

// Only the CASCADE tables. Requests, print orders and Meta accounts survive a
// delete and are described separately, because "kept but orphaned" is a
// different warning from "destroyed".
const IMPACT_LABELS: {
  key: keyof DeletionImpact;
  one: string;
  many: string;
}[] = [
  { key: "posts", one: "blog post", many: "blog posts" },
  { key: "social", one: "social post", many: "social posts" },
  {
    key: "sites",
    one: "site and its check history",
    many: "sites and their check history",
  },
  { key: "tasks", one: "task", many: "tasks" },
  { key: "timeEntries", one: "logged time entry", many: "logged time entries" },
  { key: "apiKeys", one: "content API key", many: "content API keys" },
  { key: "dmarcDomains", one: "DMARC domain", many: "DMARC domains" },
];

function impactLines(impact: DeletionImpact): string[] {
  return IMPACT_LABELS.filter(({ key }) => impact[key] > 0).map(
    ({ key, one, many }) => `${impact[key]} ${impact[key] === 1 ? one : many}`
  );
}

function DeleteDialog({
  client,
  open,
  onOpenChange,
}: {
  client: ArchivedClient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [typed, setTyped] = useState("");
  const lines = impactLines(client.impact);
  // The button unlocks only on an exact match. The server checks this again,
  // along with the archived state, so the dialog is a courtesy rather than the
  // safeguard.
  const confirmed = typed.trim() === client.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="space-y-1">
          <DialogTitle>Delete {client.name}?</DialogTitle>
          <DialogDescription>
            This cannot be undone. Archiving is reversible; this is not.
          </DialogDescription>
        </div>

        <div className="space-y-3">
          {lines.length > 0 ? (
            <div className="space-y-1.5 rounded-card border border-destructive/40 bg-destructive/5 p-4">
              <p className="text-sm font-medium">
                Deleting permanently destroys:
              </p>
              <ul className="list-inside list-disc space-y-0.5 text-sm">
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {client.impact.timeEntries > 0 ? (
                <p className="pt-1 text-xs text-destructive">
                  Logged time is billing history. Nothing else in Spotlight
                  records it.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="rounded-card border bg-card p-4 text-sm text-muted-foreground">
              This client has no posts, sites, tasks or logged time. Nothing
              will be destroyed with them.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Any requests, print orders or connected Meta accounts are kept, but
            lose their link to this client and return to the unassigned inbox.
          </p>

          <div className="space-y-1.5">
            <label htmlFor={`confirm-${client.id}`} className="text-sm">
              Type <span className="font-medium">{client.name}</span> to
              confirm.
            </label>
            <input
              id={`confirm-${client.id}`}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              className={fieldInputClass}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <form action={deleteClient}>
            <input type="hidden" name="id" value={client.id} />
            <input type="hidden" name="confirm_name" value={typed.trim()} />
            {/* Dismissed on submit, not after. The action revalidates the page
                and the client leaves the list, but this dialog is rendered from
                a local copy of it, so without this it would sit open describing
                something that no longer exists. onClick does not prevent the
                submit; it just closes the dialog on the way out. */}
            <Button
              type="submit"
              variant="destructive"
              disabled={!confirmed}
              onClick={() => onOpenChange(false)}
            >
              Delete permanently
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ArchivedClients({ clients }: { clients: ArchivedClient[] }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<ArchivedClient | null>(null);

  if (clients.length === 0) return null;

  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {open ? "Hide" : "Show"} archived ({clients.length})
      </button>

      {open ? (
        <ul className="grid gap-2">
          {clients.map((client) => (
            <li
              key={client.id}
              className="flex flex-wrap items-center gap-3 rounded-card border border-dashed bg-card/50 p-3"
            >
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-control bg-muted text-xs font-semibold text-muted-foreground"
              >
                {client.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={client.logo_url}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  initialsFrom(client.name)
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {client.name}
              </span>
              <form action={restoreClient}>
                <input type="hidden" name="id" value={client.id} />
                <Button type="submit" variant="outline" size="sm">
                  Restore
                </Button>
              </form>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDeleting(client)}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {deleting ? (
        <DeleteDialog
          key={deleting.id}
          client={deleting}
          open={true}
          onOpenChange={(next) => {
            if (!next) setDeleting(null);
          }}
        />
      ) : null}
    </section>
  );
}
