"use client";

import { cn } from "@/lib/utils";

// A character counter with BANDS rather than a hard line.
//
// A counter that is fine at 59 and alarming at 61 tells you nothing you could
// not already see: by the time it changes colour the damage is done and the
// advice arrives too late to act on. The amber band is the useful part, because
// it says "you are close, start tightening" while there is still room to.
//
// Note the palette has no green: --status-ok is a deepened gold. "Comfortable"
// therefore reads as gold here rather than green, which is deliberate rather
// than a substitution.
//
// The limit is advice, not a constraint. Nothing stops you going over, because
// sometimes the right title is 63 characters and a hard stop would just mean
// writing a worse one. The database caps sit far higher (120 for the meta title,
// 500 for the excerpt) and exist only to refuse something absurd.
export function CharCounter({
  value,
  limit,
  warnAt,
  hint,
}: {
  value: string;
  // Past this, the count reads danger.
  limit: number;
  // From here to the limit, the count reads warn. Defaults to 85% of the limit.
  warnAt?: number;
  // Optional note beside the count, e.g. what the number means.
  hint?: string;
}) {
  const count = value.trim().length;
  const amber = warnAt ?? Math.round(limit * 0.85);

  const tone =
    count > limit
      ? "text-status-danger"
      : count >= amber
        ? "text-status-warn"
        : "text-status-ok";

  return (
    <div className="flex items-baseline justify-between gap-2">
      {hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : (
        <span />
      )}
      <span
        className={cn("text-xs tabular-nums", count === 0 ? "text-muted-foreground" : tone)}
      >
        {count}/{limit}
        <span className="sr-only">
          {count > limit
            ? " characters, over the recommended limit"
            : count >= amber
              ? " characters, approaching the recommended limit"
              : " characters"}
        </span>
      </span>
    </div>
  );
}
