import { cn } from "@/lib/utils";
import { londonParts } from "@/lib/social/london";

// A post as the runway needs it: any array with status + scheduled_at
// satisfies this (the page's PostRow, or the all-projects view's lean rows).
// caption is optional and only feeds the dot tooltip.
export type RunwayPost = {
  status: string;
  scheduled_at: string | null;
  caption?: string;
};

// Fixed comparison window: every runway renders on the same 28-day scale so
// bars are comparable side by side on the all-projects view later. A queue
// scheduled beyond the window caps the fill at 100%; the label keeps the true
// day count.
const RUNWAY_WINDOW_DAYS = 28;
// Under a week of cover is one batch-scheduling cycle from dry: warn while
// there is still time to top up. Zero (or nothing queued) is danger.
const RUNWAY_WARN_DAYS = 7;

const TONE = {
  danger: { text: "text-status-danger", fill: "bg-status-danger" },
  warn: { text: "text-status-warn", fill: "bg-status-warn" },
  ok: { text: "text-status-ok", fill: "bg-status-ok" },
};

// London calendar-day offset between two YYYY-MM-DD strings (from londonParts,
// so the maths never touches the server's UTC wall clock).
function dayDiff(fromYmd: string, toYmd: string): number {
  const toUtc = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(toYmd) - toUtc(fromYmd)) / 86400000);
}

// Scheduling runway: how far into the future this client's queue extends.
// Presentational only -- callers pass their posts unfiltered; it reads the
// scheduled ones, places a dot per post on the window, and fills the bar to the
// furthest slot. A slot whose time just passed (publisher not yet claimed it)
// clamps to today rather than counting backwards.
export function SocialRunway({
  posts,
  windowDays = RUNWAY_WINDOW_DAYS,
}: {
  posts: RunwayPost[];
  windowDays?: number;
}) {
  const today = londonParts(new Date().toISOString()).date;

  const scheduled = posts
    .filter((post) => post.status === "scheduled" && post.scheduled_at)
    .map((post) => {
      const iso = post.scheduled_at as string;
      const { date, time } = londonParts(iso);
      const when = `${new Date(iso).toLocaleDateString("en-GB", {
        timeZone: "Europe/London",
        day: "numeric",
        month: "short",
        year: "numeric",
      })}, ${time}`;
      return {
        offset: Math.max(0, dayDiff(today, date)),
        tooltip: post.caption ? `${when} — ${post.caption}` : when,
      };
    });

  const runwayDays = scheduled.reduce((max, s) => Math.max(max, s.offset), 0);
  const tone =
    scheduled.length === 0 || runwayDays === 0
      ? TONE.danger
      : runwayDays < RUNWAY_WARN_DAYS
        ? TONE.warn
        : TONE.ok;
  const fillPct = Math.min(runwayDays / windowDays, 1) * 100;

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        {scheduled.length === 0 ? (
          <span className={cn("font-medium", TONE.danger.text)}>
            No posts scheduled — queue is dry
          </span>
        ) : (
          <>
            <span className={cn("font-medium", tone.text)}>
              Scheduled {runwayDays} day{runwayDays === 1 ? "" : "s"} ahead
            </span>{" "}
            · {scheduled.length} post{scheduled.length === 1 ? "" : "s"} queued
          </>
        )}
      </p>
      <div className="relative h-2.5 w-full overflow-hidden rounded-pill bg-muted">
        {scheduled.length > 0 ? (
          <div
            className={cn(
              "absolute inset-y-0 left-0 rounded-pill opacity-30",
              tone.fill
            )}
            style={{ width: `${fillPct}%` }}
          />
        ) : null}
        {scheduled.map((entry, index) => (
          <span
            key={index}
            title={entry.tooltip}
            className={cn(
              "absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
              tone.fill
            )}
            style={{
              left: `${Math.min(entry.offset / windowDays, 1) * 100}%`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
