"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrendPoint } from "@/lib/gsc/search-analytics";

const HEIGHT = 240;

function shortDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// Daily-clicks trend. recharts is client-only and ResponsiveContainer measures
// the DOM, so we render a same-size placeholder until mounted — the server and
// first client paint match (no hydration mismatch), then the chart swaps in.
export function SeoTrendChart({ data }: { data: TrendPoint[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
            <linearGradient id="seo-clicks-fill" x1="0" y1="0" x2="0" y2="1">
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
            formatter={(value) => [value, "Clicks"]}
          />
          <Area
            type="monotone"
            dataKey="clicks"
            stroke="var(--brand)"
            strokeWidth={2}
            fill="url(#seo-clicks-fill)"
            // recharts 2.x animates the area via a left-to-right clip-path
            // (react-smooth); under React 19 that animation gets stuck at width
            // 0, leaving only the first point visible. Disabling it renders the
            // full series immediately.
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
