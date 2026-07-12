"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MonitoringChip } from "@/components/monitoring-chip";
import {
  ClientFormDialog,
  type ClientRow,
} from "@/components/client-form-dialog";
import { checkAllMonitored } from "@/lib/sites/actions";
import type { ChipTone } from "@/lib/sites/monitoring";
import type { SiteFormState } from "@/lib/sites/schemas";

const TONE_TEXT: Record<ChipTone, string> = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  danger: "text-destructive",
  muted: "text-muted-foreground",
};

export type AttentionRow = {
  id: string;
  clientName: string;
  clientSlug: string;
  hostname: string;
  issue: string;
  tone: ChipTone;
  sortRank: number;
  soonestDays: number | null;
};

export type RosterChip = { label: string; tone: ChipTone };

export type RosterRow = {
  client: ClientRow;
  kind: "healthy" | "unchecked" | "empty";
  chips: RosterChip[];
};

export type FailedPostAttention = {
  id: string;
  clientName: string;
  clientSlug: string;
  caption: string;
  issue: string;
};

export type BoardModel = {
  summary: { down: number; atRisk: number; healthy: number };
  attention: AttentionRow[];
  roster: RosterRow[];
  failedPosts: FailedPostAttention[];
};

function CheckAllButton() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SiteFormState, FormData>(
    checkAllMonitored,
    null
  );
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={formAction}>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Checking…" : "Check all"}
      </Button>
    </form>
  );
}

function SummaryCard({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: ChipTone;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p
        className={cn(
          "text-2xl font-semibold tabular-nums",
          count > 0 ? TONE_TEXT[tone] : TONE_TEXT.muted
        )}
      >
        {count}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

// The cross-client monitoring board: summary counts, a Needs attention zone
// (one row per at-risk site, worst-first) and the Healthy/roster zone (one row
// per client not needing attention). Open goes to that client's Sites tab.
export function MonitoringBoard({ board }: { board: BoardModel }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
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

  const { summary, attention, roster, failedPosts } = board;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-lg font-medium">Monitoring</h1>
          <p className="text-sm text-muted-foreground">
            Status across all your clients.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CheckAllButton />
          <Button onClick={openAdd}>Add client</Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <SummaryCard label="Down" count={summary.down} tone="danger" />
        <SummaryCard label="At risk" count={summary.atRisk} tone="warn" />
        <SummaryCard label="Healthy" count={summary.healthy} tone="ok" />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          Needs attention
        </h2>
        {attention.length === 0 && failedPosts.length === 0 ? (
          <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            All clear. Nothing needs attention.
          </p>
        ) : (
          <ul className="grid gap-2">
            {attention.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {row.clientName}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {row.hostname}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <MonitoringChip tone={row.tone}>{row.issue}</MonitoringChip>
                  <Button
                    variant="outline"
                    size="sm"
                    render={
                      <Link href={`/c/${row.clientSlug}/sites/${row.id}`} />
                    }
                  >
                    Open
                  </Button>
                </div>
              </li>
            ))}
            {failedPosts.map((post) => (
              <li
                key={post.id}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {post.clientName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {post.caption || "No caption"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <MonitoringChip tone="danger">{post.issue}</MonitoringChip>
                  <Button
                    variant="outline"
                    size="sm"
                    render={
                      <Link
                        href={`/c/${post.clientSlug}/social?status=failed`}
                      />
                    }
                  >
                    Open
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Clients</h2>
        {roster.length === 0 ? (
          <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            No clients yet. Add your first client to get started.
          </p>
        ) : (
          <ul className="grid gap-2">
            {roster.map((row) => (
              <li
                key={row.client.id}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium">
                    {row.client.name}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {row.kind === "empty" ? (
                      <span className="text-xs text-muted-foreground">
                        No sites yet
                      </span>
                    ) : row.kind === "unchecked" ? (
                      <MonitoringChip tone="muted">
                        Not yet checked
                      </MonitoringChip>
                    ) : (
                      row.chips.map((chip) => (
                        <MonitoringChip key={chip.label} tone={chip.tone}>
                          {chip.label}
                        </MonitoringChip>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link href={`/c/${row.client.slug}/sites`} />}
                  >
                    Open
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(row.client)}
                  >
                    Edit
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ClientFormDialog
        key={dialogKey}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        client={editing}
      />
    </div>
  );
}
