import { createClient } from "@/lib/supabase/server";
import {
  TimeBoard,
  type TimeCardInput,
  type AdjustmentItem,
} from "@/components/time-board";

// The operator-level retainer-time board. RLS on time_entries (owns_client) and
// clients scopes every row to the operator, so no client filter is needed. Usage
// is derived, no worker: entries are bucketed into the current month by
// started_at and summed here. The month window is UTC, matching the DB's
// date_trunc('month', now()); a session that straddles the BST/UTC boundary at
// the 1st can land in the neighbouring month, which a manual adjust corrects.
//
// This page passes settled seconds plus, for a running client, the server
// started_at; the client board ticks the live elapsed off that timestamp. Card
// order is computed here once from a settled+live snapshot and kept stable while
// the board ticks; it refreshes on the next render (a timer start/stop).
export const dynamic = "force-dynamic";

type EntryRow = {
  id: string;
  client_id: string;
  kind: "timer" | "manual";
  started_at: string;
  ended_at: string | null;
  adjust_seconds: number | null;
  note: string | null;
};

type ClientRow = {
  id: string;
  name: string;
  slug: string;
  retainer_minutes: number | null;
};

// Settled seconds a single entry contributes this month. A finished timer counts
// its wall time; a manual entry counts its signed adjustment. A RUNNING timer
// (kind='timer', ended_at null) contributes 0 to settled — its elapsed is ticked
// live on the client instead.
function settledSeconds(entry: EntryRow): number {
  if (entry.kind === "manual") return entry.adjust_seconds ?? 0;
  if (entry.ended_at === null) return 0;
  const ms = Date.parse(entry.ended_at) - Date.parse(entry.started_at);
  return Math.round(ms / 1000);
}

export default async function TimePage() {
  const supabase = await createClient();

  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const nextMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  );

  const [clientsResult, entriesResult] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, slug, retainer_minutes")
      .neq("status", "archived")
      .order("name"),
    supabase
      .from("time_entries")
      .select("id, client_id, kind, started_at, ended_at, adjust_seconds, note")
      .gte("started_at", monthStart.toISOString())
      .lt("started_at", nextMonthStart.toISOString())
      .order("started_at", { ascending: false }),
  ]);

  const clients = (clientsResult.data ?? []) as ClientRow[];
  const entries = (entriesResult.data ?? []) as EntryRow[];

  // Per client: settled seconds this month, and the running timer's started_at.
  // A running timer is kind='timer' with ended_at null; if more than one is
  // somehow open (double-click, crash), we surface the EARLIEST as the single
  // visible stopwatch — stopTimer closes all of them.
  const usedByClient = new Map<string, number>();
  const runningByClient = new Map<string, string>();
  // Entries arrive newest-first, so pushing preserves that order per client.
  const adjustmentsByClient = new Map<string, AdjustmentItem[]>();
  for (const entry of entries) {
    usedByClient.set(
      entry.client_id,
      (usedByClient.get(entry.client_id) ?? 0) + settledSeconds(entry)
    );
    if (entry.kind === "timer" && entry.ended_at === null) {
      const current = runningByClient.get(entry.client_id);
      if (current === undefined || entry.started_at < current) {
        runningByClient.set(entry.client_id, entry.started_at);
      }
    }
    if (entry.kind === "manual") {
      const list = adjustmentsByClient.get(entry.client_id) ?? [];
      list.push({
        id: entry.id,
        startedAt: entry.started_at,
        adjustSeconds: entry.adjust_seconds ?? 0,
        note: entry.note,
      });
      adjustmentsByClient.set(entry.client_id, list);
    }
  }

  const cards: TimeCardInput[] = clients.map((client) => ({
    id: client.id,
    name: client.name,
    slug: client.slug,
    retainerMinutes: client.retainer_minutes,
    settledSeconds: usedByClient.get(client.id) ?? 0,
    runningSince: runningByClient.get(client.id) ?? null,
    adjustments: adjustmentsByClient.get(client.id) ?? [],
  }));

  // Stable order: most-depleted first (lowest remaining, so over-allocated float
  // up), clients with no allocation last, ties by name. The snapshot folds in a
  // running timer's live elapsed so a card mid-session sorts by its true burn.
  const serverNow = now.getTime();
  function remainingSnapshot(card: TimeCardInput): number | null {
    if (card.retainerMinutes === null) return null;
    const live =
      card.runningSince === null
        ? 0
        : Math.max(0, (serverNow - Date.parse(card.runningSince)) / 1000);
    return card.retainerMinutes * 60 - (card.settledSeconds + live);
  }
  cards.sort((a, b) => {
    const ar = remainingSnapshot(a);
    const br = remainingSnapshot(b);
    const aUnset = ar === null;
    const bUnset = br === null;
    if (aUnset !== bUnset) return aUnset ? 1 : -1;
    if (ar !== null && br !== null && ar !== br) return ar - br;
    return a.name.localeCompare(b.name);
  });

  const monthLabel = monthStart.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Time</h1>
        <p className="text-sm text-muted-foreground">
          Retainer hours used this month across every client. Start or stop each
          client&apos;s timer from its card; several clients can run at once.
          Resets on the 1st; unused hours do not roll over.
        </p>
      </div>

      <TimeBoard cards={cards} monthLabel={monthLabel} />
    </div>
  );
}
