"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { fieldInputClass } from "@/components/form-field";
import {
  createSite,
  updateSite,
  loadSiteFormProperties,
} from "@/lib/sites/actions";
import {
  INTERVAL_OPTIONS,
  DEFAULT_INTERVAL_MINUTES,
  type SiteFormState,
} from "@/lib/sites/schemas";
import type { SiteView } from "@/lib/sites/monitoring";
import type { GscPropertiesResult } from "@/lib/gsc/properties";
import type { Ga4PropertiesResult } from "@/lib/ga4/properties";

// Add/edit site modal. site === null is the add case (uses clientId); otherwise
// pre-filled for editing. Mount under a changing key so each open is fresh.
export function SiteFormDialog({
  open,
  onOpenChange,
  clientId,
  site,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  site: SiteView | null;
}) {
  const router = useRouter();
  const isEdit = site !== null;
  const action = isEdit ? updateSite : createSite;
  const [state, formAction, pending] = useActionState<SiteFormState, FormData>(
    action,
    null
  );

  const [url, setUrl] = useState(site?.url ?? "");
  const [label, setLabel] = useState(site?.label ?? "");
  const [intervalValue, setIntervalValue] = useState(
    String(site?.checkIntervalMinutes ?? DEFAULT_INTERVAL_MINUTES)
  );
  const [enabled, setEnabled] = useState(site?.monitoringEnabled ?? true);

  // Property lists load lazily when the edit dialog opens (a live Google call
  // behind the token layer), so the Overview landing page stays DB-only. Add
  // mode has no property mapping, so it never fetches. null = still loading.
  const [properties, setProperties] = useState<{
    gsc: GscPropertiesResult;
    ga4: Ga4PropertiesResult;
  } | null>(null);

  useEffect(() => {
    if (!open || !isEdit) return;
    let active = true;
    loadSiteFormProperties().then((result) => {
      if (active) setProperties(result);
    });
    return () => {
      active = false;
    };
  }, [open, isEdit]);

  useEffect(() => {
    if (state?.ok) {
      onOpenChange(false);
      router.refresh();
    }
  }, [state, onOpenChange, router]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="space-y-1">
          <DialogTitle>{isEdit ? "Edit site" : "Add site"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this site's monitoring settings."
              : "Add a site to monitor for this client."}
          </DialogDescription>
        </div>
        <form action={formAction} className="space-y-4">
          {site ? (
            <input type="hidden" name="id" value={site.id} />
          ) : (
            <input type="hidden" name="client_id" value={clientId} />
          )}

          <div className="space-y-1.5">
            <label htmlFor="site-url" className="text-sm font-medium">
              URL
            </label>
            <input
              id="site-url"
              name="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              autoFocus
              required
              placeholder="example.com"
              className={fieldInputClass}
            />
            {state?.fieldErrors?.url ? (
              <p className="text-sm text-destructive">
                {state.fieldErrors.url[0]}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="site-label" className="text-sm font-medium">
              Label <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              id="site-label"
              name="label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className={fieldInputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="site-interval" className="text-sm font-medium">
              Check interval
            </label>
            <select
              id="site-interval"
              name="check_interval_minutes"
              value={intervalValue}
              onChange={(event) => setIntervalValue(event.target.value)}
              className={fieldInputClass}
            >
              {INTERVAL_OPTIONS.map((option) => (
                <option key={option.minutes} value={option.minutes}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {isEdit ? (
            <div className="space-y-1.5">
              <label htmlFor="site-gsc" className="text-sm font-medium">
                Search Console property
              </label>
              {properties === null ? (
                <p className="text-sm text-muted-foreground">
                  Loading properties…
                </p>
              ) : properties.gsc.status === "connected" ? (
                <>
                  <select
                    id="site-gsc"
                    name="gsc_property"
                    defaultValue={site?.gscProperty ?? ""}
                    className={fieldInputClass}
                  >
                    <option value="">Not mapped</option>
                    {properties.gsc.properties.map((property) => (
                      <option key={property.siteUrl} value={property.siteUrl}>
                        {property.siteUrl}
                      </option>
                    ))}
                  </select>
                  {state?.fieldErrors?.gsc_property ? (
                    <p className="text-sm text-destructive">
                      {state.fieldErrors.gsc_property[0]}
                    </p>
                  ) : null}
                </>
              ) : properties.gsc.status === "not_connected" ? (
                <p className="text-sm text-muted-foreground">
                  <Link
                    href="/settings/integrations"
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Connect Search Console
                  </Link>{" "}
                  to map a property.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Search Console access needs renewing —{" "}
                  <Link
                    href="/settings/integrations"
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    reconnect
                  </Link>
                  .
                </p>
              )}
            </div>
          ) : null}

          {isEdit ? (
            <div className="space-y-1.5">
              <label htmlFor="site-ga4" className="text-sm font-medium">
                Google Analytics property
              </label>
              {properties === null ? (
                <p className="text-sm text-muted-foreground">
                  Loading properties…
                </p>
              ) : properties.ga4.status === "connected" ? (
                <>
                  <select
                    id="site-ga4"
                    name="ga4_property"
                    defaultValue={site?.ga4Property ?? ""}
                    className={fieldInputClass}
                  >
                    <option value="">Not mapped</option>
                    {properties.ga4.properties.map((property) => (
                      <option key={property.property} value={property.property}>
                        {property.displayName}
                      </option>
                    ))}
                  </select>
                  {state?.fieldErrors?.ga4_property ? (
                    <p className="text-sm text-destructive">
                      {state.fieldErrors.ga4_property[0]}
                    </p>
                  ) : null}
                </>
              ) : properties.ga4.status === "not_connected" ? (
                <p className="text-sm text-muted-foreground">
                  <Link
                    href="/settings/integrations"
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Connect Google Analytics
                  </Link>{" "}
                  to map a property.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Google Analytics access needs renewing —{" "}
                  <Link
                    href="/settings/integrations"
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    reconnect
                  </Link>
                  .
                </p>
              )}
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="monitoring_enabled"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="size-4 rounded border-input accent-brand"
            />
            Monitoring enabled
          </label>

          {state?.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
