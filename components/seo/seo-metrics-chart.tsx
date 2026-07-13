"use client";

import { useState, useSyncExternalStore } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import type {
  MetricDelta,
  SearchTotals,
  SeoDeltas,
  TrendPoint,
} from "@/lib/gsc/search-analytics";

const HEIGHT = 260;

type MetricKey = keyof SeoDeltas;

// The four metrics, in card + toggle order. Colours are the decorative warm
// categorical series tokens (globals.css); position is lower-is-better, so its
// axis is reversed. cardValue formats the headline totals; tip formats the
// tooltip values.
const METRICS: {
  key: MetricKey;
  label: string;
  color: string;
  cardValue: (t: SearchTotals) => string;
  tip: (v: number) => string;
  axisTick: (v: number) => string;
  reversed: boolean;
}[] = [
  {
    key: "clicks",
    label: "Clicks",
    color: "var(--chart-metric-clicks)",
    cardValue: (t) => t.clicks.toLocaleString(),
    tip: (v) => Math.round(v).toLocaleString(),
    axisTick: (v) => v.toLocaleString(),
    reversed: false,
  },
  {
    key: "impressions",
    label: "Impressions",
    color: "var(--chart-metric-impressions)",
    cardValue: (t) => t.impressions.toLocaleString(),
    tip: (v) => Math.round(v).toLocaleString(),
    axisTick: (v) => v.toLocaleString(),
    reversed: false,
  },
  {
    key: "ctr",
    label: "CTR",
    color: "var(--chart-metric-ctr)",
    cardValue: (t) => `${(t.ctr * 100).toFixed(1)}%`,
    tip: (v) => `${(v * 100).toFixed(1)}%`,
    axisTick: (v) => `${Math.round(v * 100)}%`,
    reversed: false,
  },
  {
    key: "position",
    label: "Avg. position",
    color: "var(--chart-metric-position)",
    cardValue: (t) => t.position.toFixed(1),
    tip: (v) => v.toFixed(1),
    axisTick: (v) => v.toFixed(0),
    reversed: true,
  },
];

const BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m])) as Record<
  MetricKey,
  (typeof METRICS)[number]
>;

function shortDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// True only after hydration (server false, client true, no notify) — the
// placeholder-then-swap pattern without setState in an effect.
const emptySubscribe = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

function DeltaBadge({ delta }: { delta: MetricDelta }) {
  if (delta.pct === null) {
    return <p className="text-xs text-muted-foreground">— vs prev</p>;
  }
  const rising = delta.pct >= 0;
  return (
    <p
      className={cn(
        "text-xs tabular-nums",
        delta.better ? "text-status-ok" : "text-status-danger"
      )}
    >
      {rising ? "▲" : "▼"} {Math.abs(delta.pct).toFixed(1)}%{" "}
      <span className="text-muted-foreground">vs prev</span>
    </p>
  );
}

// GSC-style multi-metric chart. The four stat cards are the toggle controls:
// click one to add/remove its line (at least one always stays on). Each active
// metric plots on its own independent Y-scale (so none flattens against
// another); at most two axis rulers show (first two active), the rest rely on
// colour + the tooltip. Defaults to Clicks + Impressions.
export function SeoMetricsChart({
  current,
  deltas,
  trend,
}: {
  current: SearchTotals;
  deltas: SeoDeltas;
  trend: TrendPoint[];
}) {
  const [active, setActive] = useState<Set<MetricKey>>(
    () => new Set<MetricKey>(["clicks", "impressions"])
  );
  const mounted = useHydrated();

  function toggle(key: MetricKey) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const activeList = METRICS.filter((m) => active.has(m.key));

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {METRICS.map((m) => {
          const isActive = active.has(m.key);
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => toggle(m.key)}
              aria-pressed={isActive}
              className={cn(
                "space-y-1 rounded-card border bg-card px-4 py-3 text-left transition-colors hover:bg-accent",
                !isActive && "opacity-60"
              )}
              style={
                isActive
                  ? { outline: `2px solid ${m.color}`, outlineOffset: "-1px" }
                  : undefined
              }
            >
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2.5 rounded-full"
                  style={{
                    backgroundColor: m.color,
                    opacity: isActive ? 1 : 0.4,
                  }}
                />
                <span className="text-xs text-muted-foreground">{m.label}</span>
              </div>
              <p className="text-2xl font-semibold tabular-nums">
                {m.cardValue(current)}
              </p>
              <DeltaBadge delta={deltas[m.key]} />
            </button>
          );
        })}
      </div>

      {!mounted ? (
        <div
          aria-hidden
          className="rounded-card border bg-card"
          style={{ height: HEIGHT }}
        />
      ) : (
        <div
          className="rounded-card border bg-card p-3"
          style={{ height: HEIGHT }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0 }}>
              <CartesianGrid
                stroke="var(--border)"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                stroke="var(--border)"
                minTickGap={24}
              />
              {activeList.map((m, i) => (
                <YAxis
                  key={m.key}
                  yAxisId={m.key}
                  orientation={i === 1 ? "right" : "left"}
                  hide={i > 1}
                  reversed={m.reversed}
                  width={48}
                  tickFormatter={m.axisTick}
                  tick={{ fontSize: 11, fill: m.color }}
                  stroke="var(--border)"
                />
              ))}
              <Tooltip
                cursor={{ stroke: "var(--border)" }}
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "var(--foreground)",
                }}
                labelFormatter={(label) => shortDate(String(label))}
                formatter={(value, name) => {
                  const m = BY_KEY[name as MetricKey];
                  return m
                    ? [m.tip(Number(value)), m.label]
                    : [String(value), String(name)];
                }}
              />
              {activeList.map((m) => (
                <Line
                  key={m.key}
                  yAxisId={m.key}
                  type="monotone"
                  dataKey={m.key}
                  stroke={m.color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
