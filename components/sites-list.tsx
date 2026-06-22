"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SiteFormDialog } from "@/components/site-form-dialog";
import { SiteRemoveDialog } from "@/components/site-remove-dialog";
import { CheckNowButton } from "@/components/check-now-button";
import { CheckAllButton } from "@/components/check-all-button";
import { MonitoringChip } from "@/components/monitoring-chip";
import type { SiteView } from "@/lib/sites/monitoring";

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
        <div className="flex items-center gap-2">
          {sites.length > 0 ? <CheckAllButton clientId={clientId} /> : null}
          <Button onClick={openAdd}>Add site</Button>
        </div>
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
                    <MonitoringChip tone="muted">Paused</MonitoringChip>
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
                      <MonitoringChip tone={site.check.statusTone}>
                        {site.check.status === "up" ? "Up" : "Down"}
                        {site.check.httpStatus
                          ? ` · ${site.check.httpStatus}`
                          : ""}
                      </MonitoringChip>
                      {site.check.responseMs != null ? (
                        <MonitoringChip tone="muted">{site.check.responseMs} ms</MonitoringChip>
                      ) : null}
                      {site.check.ssl ? (
                        <MonitoringChip tone={site.check.ssl.tone}>
                          {site.check.ssl.label}
                        </MonitoringChip>
                      ) : null}
                      {site.check.domain ? (
                        <MonitoringChip tone={site.check.domain.tone}>
                          {site.check.domain.label}
                        </MonitoringChip>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        Checked {site.check.checkedAtLabel}
                      </span>
                    </>
                  ) : (
                    <MonitoringChip tone="muted">Not yet checked</MonitoringChip>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <CheckNowButton siteId={site.id} />
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
