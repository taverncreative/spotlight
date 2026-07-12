"use client";

import { useSyncExternalStore } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrendPoint } from "@/lib/ga4/reports";

const HEIGHT = 240;

function shortDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// True only after hydration: the server snapshot is false, the client
// snapshot true, and nothing ever notifies — the placeholder-then-swap
// behaviour of the old mounted flag without setState in an effect.
const emptySubscribe = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

// Daily-sessions trend. recharts is client-only and ResponsiveContainer measures
// the DOM, so we render a same-size placeholder until mounted (no hydration
// mismatch), then swap in the chart. isAnimationActive is off because recharts
// 2.x's entry animation stalls at width 0 under React 19.
export function AnalyticsTrendChart({ data }: { data: TrendPoint[] }) {
  const mounted = useHydrated();

  if (!mounted) {
    return (
      <div
        aria-hidden
        className="rounded-lg border bg-card"
        style={{ height: HEIGHT }}
      />
    );
  }

  return (
    <div className="rounded-lg border bg-card p-3" style={{ height: HEIGHT }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
        >
          <defs>
            <linearGradient
              id="analytics-sessions-fill"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
            </linearGradient>
          </defs>
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
          <YAxis
            width={40}
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            stroke="var(--border)"
          />
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
            formatter={(value) => [value, "Sessions"]}
          />
          <Area
            type="monotone"
            dataKey="sessions"
            stroke="var(--brand)"
            strokeWidth={2}
            fill="url(#analytics-sessions-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
