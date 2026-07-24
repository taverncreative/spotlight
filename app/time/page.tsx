import { createClient } from "@/lib/supabase/server";
import {
  TimeBoard,
  type TimeCard,
  type TimeTotal,
} from "@/components/time-board";

// The operator-level retainer-time board. RLS on time_entries (owns_client) and
// clients scopes every row to the operator, so no client filter is needed. Usage
// is derived, no worker: entries are bucketed into the current month by
// started_at and summed here. The month window is UTC, matching the DB's
// date_trunc('month', now()); a session that straddles the BST/UTC boundary at
// the 1st can land in the neighbouring month, which a manual adjust corrects.
export const dynamic = "force-dynamic";

type EntryRow = {
  client_id: string;
  kind: "timer" | "manual";
  started_at: string;
  ended_at: string | null;
  adjust_seconds: number | null;
};

type ClientRow = {
  id: string;
  name: string;
  slug: string;
  retainer_minutes: number | null;
};

// Settled seconds a single entry contributes this month. A finished timer counts
// its wall time; a manual entry counts its signed adjustment. A RUNNING timer
// (kind='timer', ended_at null) contributes 0 here — it is deliberately excluded
// from settled and only surfaces as a live tick in a later slice.
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
      .select("client_id, kind, started_at, ended_at, adjust_seconds")
      .gte("started_at", monthStart.toISOString())
      .lt("started_at", nextMonthStart.toISOString()),
  ]);

  const clients = (clientsResult.data ?? []) as ClientRow[];
  const entries = (entriesResult.data ?? []) as EntryRow[];

  // Settled seconds per client this month.
  const usedByClient = new Map<string, number>();
  for (const entry of entries) {
    usedByClient.set(
      entry.client_id,
      (usedByClient.get(entry.client_id) ?? 0) + settledSeconds(entry)
    );
  }

  const cards: TimeCard[] = clients.map((client) => {
    const usedSeconds = usedByClient.get(client.id) ?? 0;
    const allocatedSeconds =
      client.retainer_minutes === null ? null : client.retainer_minutes * 60;

    if (allocatedSeconds === null) {
      return {
        id: client.id,
        name: client.name,
        slug: client.slug,
        retainerMinutes: null,
        allocatedSeconds: null,
        usedSeconds,
        remainingSeconds: null,
        percent: null,
        tier: "unset",
      };
    }

    const remainingSeconds = allocatedSeconds - usedSeconds;
    const percent =
      allocatedSeconds > 0 ? (usedSeconds / allocatedSeconds) * 100 : null;
    const tier =
      percent === null
        ? usedSeconds > 0
          ? "danger"
          : "ok"
        : percent < 75
          ? "ok"
          : percent <= 100
            ? "warn"
            : "danger";

    return {
      id: client.id,
      name: client.name,
      slug: client.slug,
      retainerMinutes: client.retainer_minutes,
      allocatedSeconds,
      usedSeconds,
      remainingSeconds,
      percent,
      tier,
    };
  });

  // Most-depleted first (lowest remaining, so over-allocated float to the top);
  // clients with no allocation set sink to the end. Ties break by name.
  cards.sort((a, b) => {
    const aUnset = a.tier === "unset";
    const bUnset = b.tier === "unset";
    if (aUnset !== bUnset) return aUnset ? 1 : -1;
    if (!aUnset && !bUnset) {
      const diff = (a.remainingSeconds ?? 0) - (b.remainingSeconds ?? 0);
      if (diff !== 0) return diff;
    }
    return a.name.localeCompare(b.name);
  });

  // The total bar sums only clients with an allocation set, so the ratio stays
  // honest; not-set clients are shown as cards but excluded here.
  let totalAllocatedSeconds = 0;
  let totalUsedSeconds = 0;
  for (const card of cards) {
    if (card.allocatedSeconds === null) continue;
    totalAllocatedSeconds += card.allocatedSeconds;
    totalUsedSeconds += card.usedSeconds;
  }
  const totalRemainingSeconds = totalAllocatedSeconds - totalUsedSeconds;
  const totalPercent =
    totalAllocatedSeconds > 0
      ? (totalUsedSeconds / totalAllocatedSeconds) * 100
      : null;
  const totalTier =
    totalPercent === null
      ? "unset"
      : totalPercent < 75
        ? "ok"
        : totalPercent <= 100
          ? "warn"
          : "danger";

  const total: TimeTotal = {
    allocatedSeconds: totalAllocatedSeconds,
    usedSeconds: totalUsedSeconds,
    remainingSeconds: totalRemainingSeconds,
    percent: totalPercent,
    tier: totalTier,
  };

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
          Retainer hours used this month across every client. Resets on the 1st;
          unused hours do not roll over.
        </p>
      </div>

      <TimeBoard total={total} cards={cards} monthLabel={monthLabel} />
    </div>
  );
}
