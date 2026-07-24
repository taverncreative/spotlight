"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AllocationEditor } from "@/components/allocation-editor";
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

// One card's raw inputs from the server (all serialisable).
export type TimeCardInput = {
  id: string;
  name: string;
  slug: string;
  retainerMinutes: number | null;
  settledSeconds: number;
  // ISO started_at of the running timer for this client, or null if stopped.
  runningSince: string | null;
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
function RunningPill({ elapsed }: { elapsed: number }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand"
        aria-hidden="true"
      />
      <span className="tabular-nums">{clock(elapsed)}</span>
      <span className="sr-only">timer running</span>
    </span>
  );
}

function StartStopButton({
  clientId,
  running,
}: {
  clientId: string;
  running: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    TimerActionState,
    FormData
  >(running ? stopTimer : startTimer, null);
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

function ClientCard({
  card,
  now,
}: {
  card: TimeCardInput;
  now: number | null;
}) {
  const { usedSeconds, allocatedSeconds, remainingSeconds, percent, tier } =
    derive(card, now);
  const unset = tier === "unset";
  const running = card.runningSince !== null;

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
          <RunningPill elapsed={liveSeconds(card.runningSince, now)} />
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

      <span className="text-xs text-muted-foreground tabular-nums">
        {unset
          ? `${hours(usedSeconds)}h logged this month`
          : `${hours(usedSeconds)}h of ${hours(allocatedSeconds ?? 0)}h`}
      </span>

      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
        <StartStopButton clientId={card.id} running={running} />
        <AllocationEditor
          clientId={card.id}
          retainerMinutes={card.retainerMinutes}
        />
      </div>
    </li>
  );
}

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
  const hasRunning = cards.some((card) => card.runningSince !== null);
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
      <TotalBar cards={cards} now={now} monthLabel={monthLabel} />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <ClientCard key={card.id} card={card} now={now} />
        ))}
      </ul>
    </div>
  );
}
