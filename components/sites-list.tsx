"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SiteFormDialog } from "@/components/site-form-dialog";
import { SiteRemoveDialog } from "@/components/site-remove-dialog";
import type { ChipTone, SiteView } from "@/lib/sites/monitoring";

const TONE_CLASS: Record<ChipTone, string> = {
  ok: "bg-emerald-500/15 text-emerald-400",
  warn: "bg-amber-500/15 text-amber-400",
  danger: "bg-destructive/15 text-destructive",
  muted: "bg-muted text-muted-foreground",
};

function Chip({
  tone,
  children,
}: {
  tone: ChipTone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium",
        TONE_CLASS[tone]
      )}
    >
      {children}
    </span>
  );
}

// The Sites module: list with monitoring chips, plus add/edit/remove. The chip
// rendering is data-driven so it lights up automatically once Slice 7 writes
// real checks; until then each site reads "Not yet checked".
export function SitesList({
  clientId,
  sites,
}: {
  clientId: string;
  sites: SiteView[];
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SiteView | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState<SiteView | null>(null);
  const [removeKey, setRemoveKey] = useState(0);

  function openAdd() {
    setEditing(null);
    setFormKey((key) => key + 1);
    setFormOpen(true);
  }
  function openEdit(site: SiteView) {
    setEditing(site);
    setFormKey((key) => key + 1);
    setFormOpen(true);
  }
  function openRemove(site: SiteView) {
    setRemoving(site);
    setRemoveKey((key) => key + 1);
    setRemoveOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Sites</h1>
          <p className="text-sm text-muted-foreground">
            Websites monitored for this client.
          </p>
        </div>
        <Button onClick={openAdd}>Add site</Button>
      </div>

      {sites.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          No sites yet. Add a site to start monitoring.
        </p>
      ) : (
        <ul className="grid gap-2">
          {sites.map((site) => (
            <li
              key={site.id}
              className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{site.hostname}</p>
                  {!site.monitoringEnabled ? (
                    <Chip tone="muted">Paused</Chip>
                  ) : null}
                </div>
                {site.label ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {site.label}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-1.5">
                  {site.check ? (
                    <>
                      <Chip tone={site.check.statusTone}>
                        {site.check.status === "up" ? "Up" : "Down"}
                        {site.check.httpStatus
                          ? ` · ${site.check.httpStatus}`
                          : ""}
                      </Chip>
                      {site.check.responseMs != null ? (
                        <Chip tone="muted">{site.check.responseMs} ms</Chip>
                      ) : null}
                      {site.check.ssl ? (
                        <Chip tone={site.check.ssl.tone}>
                          {site.check.ssl.label}
                        </Chip>
                      ) : null}
                      {site.check.domain ? (
                        <Chip tone={site.check.domain.tone}>
                          {site.check.domain.label}
                        </Chip>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        Checked {site.check.checkedAtLabel}
                      </span>
                    </>
                  ) : (
                    <Chip tone="muted">Not yet checked</Chip>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(site)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openRemove(site)}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SiteFormDialog
        key={`form-${formKey}`}
        open={formOpen}
        onOpenChange={setFormOpen}
        clientId={clientId}
        site={editing}
      />
      <SiteRemoveDialog
        key={`remove-${removeKey}`}
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        site={removing}
      />
    </div>
  );
}
