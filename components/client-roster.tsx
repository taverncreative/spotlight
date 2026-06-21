"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ClientFormDialog,
  type ClientRow,
} from "@/components/client-form-dialog";
import { CLIENT_STATUS_LABELS } from "@/lib/clients/schemas";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  paused: "secondary",
  archived: "outline",
};

// The client roster on /home: list, add and edit. Open links to the client's
// console; Edit and Add open the shared modal. A changing key remounts the modal
// so each open starts from a clean form state.
export function ClientRoster({ clients }: { clients: ClientRow[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [openKey, setOpenKey] = useState(0);

  function openAdd() {
    setEditing(null);
    setOpenKey((key) => key + 1);
    setOpen(true);
  }

  function openEdit(client: ClientRow) {
    setEditing(client);
    setOpenKey((key) => key + 1);
    setOpen(true);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-lg font-medium">Clients</h1>
          <p className="text-sm text-muted-foreground">
            Select a client to open its console.
          </p>
        </div>
        <Button onClick={openAdd}>Add client</Button>
      </div>

      {clients.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          No clients yet. Add your first client to get started.
        </p>
      ) : (
        <ul className="grid gap-2">
          {clients.map((client) => (
            <li
              key={client.id}
              className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="truncate text-sm font-medium">{client.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  /c/{client.slug}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={STATUS_VARIANT[client.status] ?? "outline"}>
                  {CLIENT_STATUS_LABELS[
                    client.status as keyof typeof CLIENT_STATUS_LABELS
                  ] ?? client.status}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href={`/c/${client.slug}/overview`} />}
                >
                  Open
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(client)}
                >
                  Edit
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ClientFormDialog
        key={openKey}
        open={open}
        onOpenChange={setOpen}
        client={editing}
      />
    </div>
  );
}
