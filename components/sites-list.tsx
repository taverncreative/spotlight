"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
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
  title = "Site health",
}: {
  clientId: string;
  sites: SiteView[];
  title?: string;
}) {
  // The slug comes from the route rather than a prop, so the server page
  // stays untouched (it lives under /c/[clientSlug]/sites).
  const { clientSlug } = useParams<{ clientSlug: string }>();
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
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
        <div className="flex items-center gap-2">
          {sites.length > 0 ? <CheckAllButton clientId={clientId} /> : null}
          <Button onClick={openAdd} size="sm">
            Add site
          </Button>
        </div>
      </div>

      {sites.length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          No sites yet. Add a site to start monitoring.
        </p>
      ) : (
        <ul className="grid gap-2">
          {sites.map((site) => (
            <li
              key={site.id}
              className="flex items-center justify-between gap-3 rounded-card border bg-card px-4 py-3"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/c/${clientSlug}/sites/${site.id}`}
                    className="truncate text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {site.hostname}
                  </Link>
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
                      <MonitoringChip
                        tone={site.check.statusTone}
                        title={
                          site.check.httpStatus != null
                            ? `HTTP ${site.check.httpStatus}`
                            : undefined
                        }
                      >
                        {site.check.statusLabel}
                      </MonitoringChip>
                      {site.check.responseMs != null ? (
                        <MonitoringChip tone="muted">
                          {site.check.responseMs} ms
                        </MonitoringChip>
                      ) : null}
                      {site.check.ssl && site.check.ssl.tone !== "ok" ? (
                        <MonitoringChip tone={site.check.ssl.tone}>
                          {site.check.ssl.label}
                        </MonitoringChip>
                      ) : null}
                      {site.check.domain && site.check.domain.tone !== "ok" ? (
                        <MonitoringChip tone={site.check.domain.tone}>
                          {site.check.domain.label}
                        </MonitoringChip>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        Checked {site.check.checkedAtLabel}
                      </span>
                    </>
                  ) : (
                    <MonitoringChip tone="muted">
                      Not yet checked
                    </MonitoringChip>
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
