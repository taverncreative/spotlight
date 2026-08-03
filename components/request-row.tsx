"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";

// One inbound request, collapsed to a line until you ask for more.
//
// WHY. Every request rendered its whole message, and a message can be 5,000
// characters. Twenty-two of those is a wall you scroll rather than a list you
// read, and the count only goes up. Collapsed, the page answers "what came in
// and how much of it needs me" at a glance, which is the question you open it
// with.
//
// WHAT SURVIVES THE COLLAPSE is the part that decides whether to open it: the
// status, who it is about, and the FIRST LINE of the message. Not a character
// truncation of the whole thing -- people put the ask in the first line and the
// detail after it, so the first line is the summary they already wrote.
//
// ACTIONS LIVE IN THE EXPANSION. A collapsed row with a row of buttons on it is
// the card grid again with less room to read. The exception is deliberate: on a
// row that has not been started, "Start" and "Done" are the whole point of the
// list, so the module can pass `quickActions` to put those two on the line.
//
// The actions arrive as pre-rendered nodes, so this component knows nothing
// about statuses, server actions or which surface it is on -- the same contract
// the calendar's day cell uses.
export function RequestRow({
  status,
  sourceApp,
  type,
  clientName,
  submitter,
  createdAt,
  message,
  actions,
  quickActions,
}: {
  status: string;
  sourceApp: string;
  type: string;
  // Only on the cross-client inbox. Inside a client's own tab it would repeat
  // the page heading on every line.
  clientName?: string;
  submitter: string | null;
  createdAt: string;
  message: string;
  actions: ReactNode;
  quickActions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const firstLine = message.split("\n")[0]?.trim() ?? "";
  // Only claim there is more when there actually is, so the chevron and the
  // "more" affordance are never a lie about an empty expansion.
  const hasMore = message.trim() !== firstLine;

  return (
    <li className="rounded-card border bg-card">
      <div className="flex items-start gap-2 p-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90"
            )}
          />
          <span className="min-w-0 flex-1 space-y-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <StatusPill status={status} />
              {clientName ? (
                <span className="text-sm font-medium">{clientName}</span>
              ) : null}
              <Badge variant="outline">{type}</Badge>
              <span className="font-mono text-[11px] text-muted-foreground">
                {sourceApp}
              </span>
            </span>
            {/* The line that does the work. Clamped rather than truncated with
                a substring, so a long first line degrades gracefully at any
                width instead of being cut at a fixed character count. */}
            <span
              className={cn(
                "block text-sm",
                open ? "text-muted-foreground" : "line-clamp-1"
              )}
            >
              {firstLine || (
                <span className="text-muted-foreground">No message</span>
              )}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-2">
          {quickActions}
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            {formatDate(createdAt)}
          </span>
        </div>
      </div>

      {open ? (
        <div className="space-y-3 border-t px-3 py-3">
          {/* The full message only when asked for. whitespace-pre-wrap because
              the sender's line breaks are theirs and re-flowing them loses the
              shape they wrote it in. */}
          {hasMore ? (
            <p className="text-sm whitespace-pre-wrap">{message}</p>
          ) : null}
          {submitter ? (
            <p className="text-xs text-muted-foreground">From {submitter}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      ) : null}
    </li>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
