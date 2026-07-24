import { cn } from "@/lib/utils";
import { AllocationEditor } from "@/components/allocation-editor";

// Read-only presentation for the retainer-time board: a total bar over a grid of
// per-client cards. All figures are computed in the page (settled seconds only)
// and passed in; this component only formats and lays them out. No interactivity
// yet — start/stop and manual adjust arrive in later slices.

export type Tier = "ok" | "warn" | "danger" | "unset";

export type TimeCard = {
  id: string;
  name: string;
  slug: string;
  retainerMinutes: number | null;
  allocatedSeconds: number | null;
  usedSeconds: number;
  remainingSeconds: number | null;
  percent: number | null;
  tier: Tier;
};

export type TimeTotal = {
  allocatedSeconds: number;
  usedSeconds: number;
  remainingSeconds: number;
  percent: number | null;
  tier: Tier;
};

// Warm-bento status tiers: gold healthy, amber running low (75-100%), red over.
const TIER_BAR: Record<Tier, string> = {
  ok: "bg-status-ok",
  warn: "bg-status-warn",
  danger: "bg-status-danger",
  unset: "",
};

// Hours to one decimal; minutes/seconds stay the integer source of truth.
function hours(seconds: number): string {
  return (seconds / 3600).toFixed(1);
}

// Fill never exceeds the track; an over-allocated card pins at 100% and turns red.
function fillWidth(percent: number | null): string {
  if (percent === null) return "0%";
  return `${Math.min(100, Math.max(0, percent))}%`;
}

function Bar({ tier, percent }: { tier: Tier; percent: number | null }) {
  return (
    <div className="h-2 overflow-hidden rounded-pill bg-secondary">
      {tier === "unset" ? null : (
        <div
          className={cn("h-full rounded-pill", TIER_BAR[tier])}
          style={{ width: fillWidth(percent) }}
        />
      )}
    </div>
  );
}

function RemainingHeadline({
  remainingSeconds,
  large,
}: {
  remainingSeconds: number;
  large?: boolean;
}) {
  const over = remainingSeconds < 0;
  const value = hours(Math.abs(remainingSeconds));
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className={cn(
          "font-semibold tabular-nums",
          large ? "text-3xl" : "text-2xl",
          over ? "text-status-danger" : "text-foreground"
        )}
      >
        {value}
      </span>
      <span className="text-sm text-muted-foreground">
        {over ? "h over" : "h left"}
      </span>
    </div>
  );
}

function TotalBar({
  total,
  monthLabel,
}: {
  total: TimeTotal;
  monthLabel: string;
}) {
  const noAllocations = total.tier === "unset";
  return (
    <div className="space-y-3 rounded-card border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Remaining across all clients · {monthLabel}
          </p>
          {noAllocations ? (
            <p className="text-xl font-semibold text-muted-foreground">
              No allocations set
            </p>
          ) : (
            <RemainingHeadline
              remainingSeconds={total.remainingSeconds}
              large
            />
          )}
        </div>
        {noAllocations ? null : (
          <p className="text-sm text-muted-foreground">
            {hours(total.usedSeconds)}h of {hours(total.allocatedSeconds)}h used
          </p>
        )}
      </div>
      {noAllocations ? null : <Bar tier={total.tier} percent={total.percent} />}
    </div>
  );
}

function ClientCard({ card }: { card: TimeCard }) {
  const unset = card.tier === "unset";
  return (
    <li
      className={cn(
        "flex flex-col gap-2.5 rounded-card border bg-card p-4",
        unset && "border-dashed"
      )}
    >
      <span className="text-sm font-medium">{card.name}</span>

      {unset ? (
        <span className="text-xl font-semibold text-muted-foreground">
          Not set
        </span>
      ) : (
        <RemainingHeadline remainingSeconds={card.remainingSeconds ?? 0} />
      )}

      <Bar tier={card.tier} percent={card.percent} />

      <span className="text-xs text-muted-foreground">
        {unset
          ? `${hours(card.usedSeconds)}h logged this month`
          : `${hours(card.usedSeconds)}h of ${hours(card.allocatedSeconds ?? 0)}h`}
      </span>

      <div className="mt-0.5 border-t pt-2.5">
        <AllocationEditor
          clientId={card.id}
          retainerMinutes={card.retainerMinutes}
        />
      </div>
    </li>
  );
}

export function TimeBoard({
  total,
  cards,
  monthLabel,
}: {
  total: TimeTotal;
  cards: TimeCard[];
  monthLabel: string;
}) {
  if (cards.length === 0) {
    return (
      <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
        No clients yet. Add a client to start tracking retainer time.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <TotalBar total={total} monthLabel={monthLabel} />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <ClientCard key={card.id} card={card} />
        ))}
      </ul>
    </div>
  );
}
