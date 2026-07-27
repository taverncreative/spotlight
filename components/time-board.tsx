"use client";

import {
  memo,
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AllocationEditor } from "@/components/allocation-editor";
import { AdjustmentDialog } from "@/components/adjustment-dialog";
import { startTimer, stopTimer } from "@/lib/time/actions";
import { type TimerActionState } from "@/lib/time/schemas";

// Live presentation for the retainer-time board: a total bar over a grid of
// per-client cards. The page passes settled seconds and, for a running client,
// the server started_at; this component ticks every second off that timestamp
// (no stored countdown) and folds the live elapsed into each card's used and
// remaining and into the total bar. Card ORDER is fixed by the server snapshot
// and does not re-sort while ticking, so cards never jump under the cursor;
// order refreshes when a timer starts or stops (revalidatePath).

export type Tier = "ok" | "warn" | "danger" | "unset";

// A manual adjustment this month, for the readable per-card list.
export type AdjustmentItem = {
  id: string;
  startedAt: string;
  adjustSeconds: number;
  note: string | null;
};

// One card's raw inputs from the server (all serialisable).
export type TimeCardInput = {
  id: string;
  name: string;
  slug: string;
  retainerMinutes: number | null;
  settledSeconds: number;
  // ISO started_at of the running timer for this client, or null if stopped.
  runningSince: string | null;
  // This month's manual adjustments, newest first.
  adjustments: AdjustmentItem[];
};

const TIER_BAR: Record<Tier, string> = {
  ok: "bg-status-ok",
  warn: "bg-status-warn",
  danger: "bg-status-danger",
  unset: "",
};

// Hours to one decimal; seconds stay the integer source of truth.
function hours(seconds: number): string {
  return (seconds / 3600).toFixed(1);
}

// Live session elapsed, in whole seconds, from a server started_at. Zero before
// mount (now === null) so the server render and first client render agree.
function liveSeconds(runningSince: string | null, now: number | null): number {
  if (runningSince === null || now === null) return 0;
  return Math.max(0, Math.floor((now - Date.parse(runningSince)) / 1000));
}

// Past this, a running timer is almost certainly forgotten rather than long. A
// working day is about 8 hours, so 12 clears any genuine long session while
// still catching one left over a lunch, a night or a weekend. One was found
// running for 68 hours, which is what prompted this.
//
// The guard NEVER stops anything. We cannot tell a forgotten timer from a long
// one, and stopping the wrong one destroys billable time that nothing else
// records. It says so loudly and leaves the decision alone.
const RUNAWAY_HOURS = 12;
const RUNAWAY_SECONDS = RUNAWAY_HOURS * 3600;

// Whole hours, for a duration too long to read as a clock: "68h" says wrong at a
// glance where 68:04:12 reads as a perfectly ordinary stopwatch.
function coarseDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function startedOn(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// Running session as a stopwatch clock: m:ss under an hour, h:mm:ss over.
function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function fillWidth(percent: number | null): string {
  if (percent === null) return "0%";
  return `${Math.min(100, Math.max(0, percent))}%`;
}

type Derived = {
  usedSeconds: number;
  allocatedSeconds: number | null;
  remainingSeconds: number | null;
  percent: number | null;
  tier: Tier;
};

function derive(card: TimeCardInput, now: number | null): Derived {
  const usedSeconds = card.settledSeconds + liveSeconds(card.runningSince, now);
  const allocatedSeconds =
    card.retainerMinutes === null ? null : card.retainerMinutes * 60;

  if (allocatedSeconds === null) {
    return {
      usedSeconds,
      allocatedSeconds: null,
      remainingSeconds: null,
      percent: null,
      tier: "unset",
    };
  }

  const remainingSeconds = allocatedSeconds - usedSeconds;
  let percent: number;
  let tier: Tier;
  if (allocatedSeconds === 0) {
    percent = usedSeconds > 0 ? 100 : 0;
    tier = usedSeconds > 0 ? "danger" : "ok";
  } else {
    percent = (usedSeconds / allocatedSeconds) * 100;
    tier = percent < 75 ? "ok" : percent <= 100 ? "warn" : "danger";
  }
  return { usedSeconds, allocatedSeconds, remainingSeconds, percent, tier };
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
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className={cn(
          "font-semibold tabular-nums",
          large ? "text-3xl" : "text-2xl",
          over ? "text-status-danger" : "text-foreground"
        )}
      >
        {hours(Math.abs(remainingSeconds))}
      </span>
      <span className="text-sm text-muted-foreground">
        {over ? "h over" : "h left"}
      </span>
    </div>
  );
}

// Terracotta pulse plus the running session clock, shown only while a timer runs.
// Past the runaway threshold it turns danger-toned and drops the seconds: at
// that length the precise clock is noise and the magnitude is the message.
function RunningPill({
  elapsed,
  runaway,
}: {
  elapsed: number;
  runaway: boolean;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-xs",
        runaway ? "font-medium text-status-danger" : "text-muted-foreground"
      )}
    >
      <span
        className={cn(
          "inline-block h-2 w-2 animate-pulse rounded-full",
          runaway ? "bg-status-danger" : "bg-brand"
        )}
        aria-hidden="true"
      />
      <span className="tabular-nums">
        {runaway ? coarseDuration(elapsed) : clock(elapsed)}
      </span>
      <span className="sr-only">
        {runaway ? "timer running unusually long" : "timer running"}
      </span>
    </span>
  );
}

// Reports each successful result upward so the card can carry the running state
// itself. Start no longer revalidates the page, so this callback IS how the
// board learns a timer began.
function StartStopButton({
  clientId,
  running,
  onResult,
}: {
  clientId: string;
  running: boolean;
  onResult: (clientId: string, runningSince: string | null) => void;
}) {
  const [state, formAction, pending] = useActionState<
    TimerActionState,
    FormData
  >(running ? stopTimer : startTimer, null);

  // Guarded by identity rather than a boolean: useActionState keeps the last
  // result, so without this the effect would re-fire on unrelated re-renders
  // (and this card re-renders every second while a timer runs).
  const handled = useRef<TimerActionState>(null);
  useEffect(() => {
    if (!state || state === handled.current) return;
    handled.current = state;
    if (state.ok) onResult(clientId, state.runningSince ?? null);
  }, [state, clientId, onResult]);

  return (
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="client_id" value={clientId} />
      <Button
        type="submit"
        size="sm"
        variant={running ? "outline" : "default"}
        disabled={pending}
      >
        {pending ? "…" : running ? "Stop" : "Start"}
      </Button>
      {state?.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}

// A manual adjustment as a signed h/m label: +30m, −1h 15m.
function signedAmount(seconds: number): string {
  const sign = seconds < 0 ? "−" : "+";
  const abs = Math.abs(seconds);
  const h = Math.floor(abs / 3600);
  const m = Math.round((abs % 3600) / 60);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h === 0) parts.push(`${m}m`);
  return `${sign}${parts.join(" ")}`;
}

function adjustmentDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

// This month's adjustments, collapsed by default so the card stays glanceable;
// expanding shows each correction's date, signed amount and note so a change can
// be understood later. Renders nothing when there are none.
function AdjustmentsList({ adjustments }: { adjustments: AdjustmentItem[] }) {
  if (adjustments.length === 0) return null;
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-xs text-muted-foreground marker:content-none hover:text-foreground">
        <span className="underline-offset-4 group-open:underline">
          Adjustments ({adjustments.length})
        </span>
      </summary>
      <ul className="mt-1.5 space-y-1.5">
        {adjustments.map((item) => (
          <li key={item.id} className="text-xs">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">
                {adjustmentDate(item.startedAt)}
              </span>
              <span className="tabular-nums font-medium">
                {signedAmount(item.adjustSeconds)}
              </span>
            </div>
            {item.note ? (
              <p className="text-muted-foreground">{item.note}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

// memo matters here: the board ticks once a second while ANY timer runs, and
// without this every card re-rendered on every tick, dialog and action-state
// form included. now is passed as null to cards that are not running, so their
// props are identical between ticks and they skip the render entirely.
const ClientCard = memo(function ClientCard({
  card,
  now,
  onResult,
}: {
  card: TimeCardInput;
  now: number | null;
  onResult: (clientId: string, runningSince: string | null) => void;
}) {
  const [adjustOpen, setAdjustOpen] = useState(false);
  const { usedSeconds, allocatedSeconds, remainingSeconds, percent, tier } =
    derive(card, now);
  const unset = tier === "unset";
  const running = card.runningSince !== null;
  const elapsed = liveSeconds(card.runningSince, now);
  const runaway = running && elapsed >= RUNAWAY_SECONDS;

  return (
    <li
      className={cn(
        "flex flex-col gap-2.5 rounded-card border bg-card p-4",
        unset && "border-dashed"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{card.name}</span>
        {running ? (
          <RunningPill elapsed={elapsed} runaway={runaway} />
        ) : null}
      </div>

      {unset ? (
        <span className="text-xl font-semibold text-muted-foreground">
          Not set
        </span>
      ) : (
        <RemainingHeadline remainingSeconds={remainingSeconds ?? 0} />
      )}

      <Bar tier={tier} percent={percent} />

      {/* Loud and inert. It does not stop the timer, exclude it from the total
          or touch the data: a long session might be real, and only the operator
          knows which. The total deliberately still includes this time, because a
          headline that looks wrong is doing its job. */}
      {runaway && card.runningSince ? (
        <p className="text-xs text-status-danger">
          Running since {startedOn(card.runningSince)}. Still working? Stop it,
          or stop and adjust the time.
        </p>
      ) : null}

      <span className="text-xs text-muted-foreground tabular-nums">
        {unset
          ? `${hours(usedSeconds)}h logged this month`
          : `${hours(usedSeconds)}h of ${hours(allocatedSeconds ?? 0)}h`}
      </span>

      <AdjustmentsList adjustments={card.adjustments} />

      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
        <div className="flex items-center gap-1.5">
          <StartStopButton
            clientId={card.id}
            running={running}
            onResult={onResult}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setAdjustOpen(true)}
          >
            Adjust
          </Button>
        </div>
        <AllocationEditor
          clientId={card.id}
          retainerMinutes={card.retainerMinutes}
        />
      </div>

      {/* Mounted only while open. It used to sit in the tree on every card, so
          ten dialog subtrees re-rendered every second for a control nobody had
          opened. Conditional mounting also supersedes the old key remount
          trick: a fresh instance is a fresh form. */}
      {adjustOpen ? (
        <AdjustmentDialog
          open={adjustOpen}
          onOpenChange={setAdjustOpen}
          clientId={card.id}
          clientName={card.name}
        />
      ) : null}
    </li>
  );
});

function TotalBar({
  cards,
  now,
  monthLabel,
}: {
  cards: TimeCardInput[];
  now: number | null;
  monthLabel: string;
}) {
  let allocatedSeconds = 0;
  let usedSeconds = 0;
  for (const card of cards) {
    const d = derive(card, now);
    if (d.allocatedSeconds === null) continue;
    allocatedSeconds += d.allocatedSeconds;
    usedSeconds += d.usedSeconds;
  }
  const noAllocations = allocatedSeconds === 0;
  const remainingSeconds = allocatedSeconds - usedSeconds;
  const percent =
    allocatedSeconds > 0 ? (usedSeconds / allocatedSeconds) * 100 : null;
  const tier: Tier = noAllocations
    ? "unset"
    : percent === null
      ? "unset"
      : percent < 75
        ? "ok"
        : percent <= 100
          ? "warn"
          : "danger";

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
            <RemainingHeadline remainingSeconds={remainingSeconds} large />
          )}
        </div>
        {noAllocations ? null : (
          <p className="text-sm text-muted-foreground tabular-nums">
            {hours(usedSeconds)}h of {hours(allocatedSeconds)}h used
          </p>
        )}
      </div>
      {noAllocations ? null : <Bar tier={tier} percent={percent} />}
    </div>
  );
}

export function TimeBoard({
  cards,
  monthLabel,
}: {
  cards: TimeCardInput[];
  monthLabel: string;
}) {
  // Start no longer revalidates the page, so a freshly started timer lives here
  // until the next server render. Held on the BOARD rather than inside the card,
  // because the headline total has to count the live seconds too; a card-local
  // optimistic state would tick the card and leave the total stale.
  const [optimistic, setOptimistic] = useState<Record<string, string | null>>(
    {}
  );

  // Any server refetch wins. cards keeps its identity between ticks and only
  // changes when the page actually re-renders (a stop, an adjustment, an
  // allocation), so this drops the overlay exactly when fresher truth arrives.
  //
  // Adjusted during render rather than in an effect: React re-runs the render
  // immediately with the new state and commits once, where an effect would
  // commit the stale overlay first and then cascade a second render.
  const [seenCards, setSeenCards] = useState(cards);
  if (cards !== seenCards) {
    setSeenCards(cards);
    setOptimistic({});
  }

  const onResult = useCallback(
    (clientId: string, runningSince: string | null) => {
      setOptimistic((current) => ({ ...current, [clientId]: runningSince }));
    },
    []
  );

  // A new object only for cards the overlay actually changes, so every other
  // card keeps its identity and memo can do its job.
  const effectiveCards = useMemo(
    () =>
      cards.map((card) => {
        const override = optimistic[card.id];
        return override === undefined || override === card.runningSince
          ? card
          : { ...card, runningSince: override };
      }),
    [cards, optimistic]
  );

  const hasRunning = effectiveCards.some((card) => card.runningSince !== null);
  // now stays null until mount, so SSR and first client render agree; then a rAF
  // sets it immediately and an interval ticks it each second while any timer runs.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!hasRunning) return;
    const tick = () => setNow(Date.now());
    const raf = requestAnimationFrame(tick);
    const id = setInterval(tick, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, [hasRunning]);

  if (cards.length === 0) {
    return (
      <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
        No clients yet. Add a client to start tracking retainer time.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <TotalBar cards={effectiveCards} now={now} monthLabel={monthLabel} />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {effectiveCards.map((card) => (
          <ClientCard
            key={card.id}
            card={card}
            // null for stopped cards: identical props between ticks, so memo
            // skips them entirely. Only running cards re-render each second.
            now={card.runningSince === null ? null : now}
            onResult={onResult}
          />
        ))}
      </ul>
    </div>
  );
}
