"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/ui/status-pill";
import type { DomainPanel, PanelTone } from "@/lib/dmarc/panel";

// One monitored domain: the four-word reassurance is the whole glanceable answer,
// with a 30-day state strip beneath it. Detail (which source/selector) is behind
// an expander and appears only on warn/danger -- never a table on the default
// view. The empty state covers a domain added but not yet reported on.

const DOT_TONE: Record<PanelTone, string> = {
  ok: "bg-status-ok",
  warn: "bg-status-warn",
  danger: "bg-status-danger",
  muted: "bg-muted",
};

export function DmarcDomainPanel({ panel }: { panel: DomainPanel }) {
  const [open, setOpen] = useState(false);
  const canExpand =
    panel.latest !== null && panel.latest.state !== "ok" && panel.offenders.length > 0;

  return (
    <li className="space-y-3 rounded-card border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-sm font-medium">{panel.domain}</span>
        {panel.latest ? (
          <StatusPill status={panel.latest.state} label={panel.latest.label} />
        ) : (
          <span className="text-xs text-muted-foreground">
            Waiting for the first report
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
    </li>
  );
}
