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
  ok: "text-status-ok",
  warn: "text-status-warn",
  danger: "text-status-danger",
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

// One row per client in the All-projects comparison table. Monitoring figures
// (up/total, soonest SSL/domain) are computed from the latest check; social
// counts and the SEO/GA4 connection flags come from cheap DB reads (no live
// Google calls). sortRank drives the worst-first order.
export type ClientComparisonRow = {
  client: ClientRow;
  kind: "monitored" | "unchecked" | "empty";
  tone: ChipTone;
  healthLabel: string;
  sortRank: number;
  upCount: number;
  totalSites: number;
  soonestSsl: number | null;
  soonestDomain: number | null;
  scheduled: number;
  failed: number;
  gscConnected: boolean;
  ga4Connected: boolean;
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
  clientRows: ClientComparisonRow[];
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
    <div className="rounded-card border bg-card px-4 py-3">
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
// (one row per at-risk site, worst-first) and the All-projects comparison table
// (one row per client, worst-first, with monitoring, social and SEO/GA4
// connection columns). Open goes to that client's Sites tab.
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

  const { summary, attention, clientRows, failedPosts } = board;

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
          <p className="rounded-card border bg-card p-4 text-sm text-muted-foreground">
            All clear. Nothing needs attention.
          </p>
        ) : (
          <ul className="grid gap-2">
            {attention.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-card border bg-card px-4 py-3"
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
                className="flex items-center justify-between gap-3 rounded-card border bg-card px-4 py-3"
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
        <h2 className="text-sm font-medium text-muted-foreground">
          All projects
        </h2>
        {clientRows.length === 0 ? (
          <p className="rounded-card border bg-card p-4 text-sm text-muted-foreground">
            No clients yet. Add your first client to get started.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-card border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Client</th>
                  <th className="px-3 py-2 text-left font-medium">Health</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Scheduled
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Failed</th>
                  <th className="px-3 py-2 text-left font-medium">SEO</th>
                  <th className="px-3 py-2 text-left font-medium">GA4</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {clientRows.map((row) => (
                  <tr key={row.client.id} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">
                      <span className="block max-w-[12rem] truncate">
                        {row.client.name}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <MonitoringChip tone={row.tone}>
                        {row.healthLabel}
                      </MonitoringChip>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.scheduled > 0 ? (
                        row.scheduled
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.failed > 0 ? (
                        <span className="text-status-danger">{row.failed}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.gscConnected ? (
                        <MonitoringChip tone="ok">Connected</MonitoringChip>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.ga4Connected ? (
                        <MonitoringChip tone="ok">Connected</MonitoringChip>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
