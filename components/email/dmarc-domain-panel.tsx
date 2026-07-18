"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DomainSetup } from "@/components/email/domain-setup";
import {
  KnownSendersEditor,
  type KnownSenderRow,
} from "@/components/email/known-senders-editor";
import { deleteDomain } from "@/lib/dmarc/actions";
import type { DomainPanel, PanelTone } from "@/lib/dmarc/panel";

// One monitored domain: the four-word reassurance is the whole glanceable answer,
// with a 30-day state strip beneath it. Offender detail (which source/selector)
// is behind an expander and appears only on warn/danger. Setup and known-sender
// management live in a "Setup & senders" disclosure -- open by default while the
// domain is pending (awaiting its first report), collapsed once it is receiving.

const DOT_TONE: Record<PanelTone, string> = {
  ok: "bg-status-ok",
  warn: "bg-status-warn",
  danger: "bg-status-danger",
  muted: "bg-muted",
};

export function DmarcDomainPanel({
  panel,
  senders,
}: {
  panel: DomainPanel;
  senders: KnownSenderRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(panel.pending);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canExpand =
    panel.latest !== null &&
    panel.latest.state !== "ok" &&
    panel.offenders.length > 0;

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteDomain(panel.id);
      if (result.ok) {
        setConfirmDelete(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <li className="space-y-3 rounded-card border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-sm font-medium">{panel.domain}</span>
        {panel.latest ? (
          <StatusPill status={panel.latest.state} label={panel.latest.label} />
        ) : (
          <span className="text-xs text-muted-foreground">
            Awaiting first report
          </span>
        )}
      </div>

      {/* 30-day state strip, oldest (left) to today (right). */}
      <div className="flex items-center gap-[3px]" aria-label="Last 30 days">
        {panel.strip.map((slot) => (
          <span
            key={slot.day}
            title={`${slot.day}: ${slot.tone === "muted" ? "no report" : slot.tone}`}
            className={cn("h-4 w-1.5 rounded-sm", DOT_TONE[slot.tone])}
          />
        ))}
      </div>

      {canExpand ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {open ? "Hide detail" : "Show detail"}
          </button>
          {open ? (
            <ul className="space-y-1.5 border-t pt-2">
              {panel.offenders.map((o, i) => (
                <li key={`${o.sourceIp}-${i}`} className="text-xs">
                  <span className="font-mono">{o.sourceIp}</span>
                  <span className="text-muted-foreground">
                    {" — "}
                    {o.classification === "broken"
                      ? "failing authentication"
                      : "not a known sender"}
                    {" — "}
                    {o.selectors} · {o.count}{" "}
                    {o.count === 1 ? "email" : "emails"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="border-t pt-2">
        <button
          type="button"
          onClick={() => setManageOpen((v) => !v)}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {manageOpen ? "Hide setup & senders" : "Setup & senders"}
        </button>

        {manageOpen ? (
          <div className="mt-3 space-y-5">
            {panel.pending ? (
              <p className="rounded-control bg-muted px-3 py-2 text-xs text-muted-foreground">
                Added and awaiting the first report. Add the DNS below; reports
                land once it propagates and the reporter next sends (usually
                within a day).
              </p>
            ) : null}

            <DomainSetup domain={panel.domain} setup={panel.setup} />

            <KnownSendersEditor domainId={panel.id} senders={senders} />

            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-xs text-muted-foreground">
                Remove this domain and all its stored reports.
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setError(null);
                  setConfirmDelete(true);
                }}
              >
                Delete domain
              </Button>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        ) : null}
      </div>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(false);
        }}
      >
        <AlertDialogContent size="sm">
          <div className="space-y-2">
            <AlertDialogTitle>Delete {panel.domain}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the domain and every report, record and known sender
              stored for it. The 30-day history is lost. This cannot be undone.
            </AlertDialogDescription>
          </div>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              onClick={remove}
              disabled={pending}
            >
              {pending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
