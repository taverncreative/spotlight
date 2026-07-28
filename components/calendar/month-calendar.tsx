import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DayDetail } from "@/components/calendar/day-detail";
import {
  agendaDays,
  bucketByDay,
  formatDayLabel,
  monthGrid,
  type CalendarItem,
} from "@/lib/calendar/grid";

// The shared calendar, module-agnostic.
//
// It knows about days, items and thumbnails. It knows nothing about posts,
// captions, platforms or publishing, which is what lets blog and social share
// it: everything module-specific arrives as data (label, status, thumbnail) or
// as a pre-rendered React node (detail, actions).
//
// A SERVER component apart from the day-detail dialog, matching the calendar it
// replaces. Only open/closed state needs the client, so only that crosses.
//
// TWO LAYOUTS, ONE DATA SET. Above sm a month grid; below it an agenda. The grid
// it replaces was min-w-[640px] inside overflow-x-auto, so on a phone you
// side-scrolled a squeezed seven-column grid to read one post a day. A calendar
// crushed to 45px columns is not a calendar. Both are rendered and toggled with
// CSS rather than a media query hook, so there is no hydration mismatch and no
// layout flash on first paint.

// Four, because four is the real crowded case: blog published four posts on
// 26 July. Social has never exceeded one a day. A cell that holds four covers
// both without an overflow chip appearing for the common case.
const VISIBLE_CHIPS = 4;
// When there are more than four, three chips leave room for the overflow row.
const CHIPS_WITH_OVERFLOW = 3;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// CALENDAR EMPHASIS, deliberately not StatusPill's semantic tone.
//
// A pill labels what something IS. A dot on a forward-looking calendar answers
// "what should I be looking at", and the answers differ: the palette's
// --status-info is a warm neutral (#8A7D6F), the quietest thing on the page, so
// inheriting it made SCHEDULED -- the only status that has not happened yet and
// the whole reason to open a calendar -- the faintest mark, while published sat
// in gold shouting about work already done.
//
// So the loud end is what is still coming or has gone wrong, and the quiet end
// is what is finished. Same fallback contract as StatusPill: an unknown status
// gets neutral styling rather than throwing on a lifecycle a module adds later.
const DOT: Record<string, string> = {
  // Not yet happened, and still changeable: the loudest mark available.
  //
  // NOT the brand terracotta, which was the obvious first choice and wrong.
  // Measured, bg-primary lands at lab(53, 41, 42) and status-danger at
  // lab(60, 51, 39) -- eight degrees of hue apart, so "coming up" and "failed,
  // fix today" became the same dot at 6px. Every accent in this warm palette
  // sits in that same orange arc, so the only high-contrast colour genuinely
  // clear of the alarm red is the neutral one.
  scheduled: "bg-foreground",
  // In flight and briefly worth watching.
  publishing: "bg-status-warn",
  // Wrong, and louder than everything: these need action today.
  failed: "bg-status-danger",
  partial: "bg-status-warn",
  // Done. Still legible, deliberately recessive -- history, not a task.
  published: "bg-muted-foreground/50",
  // Planned, not committed. HOLLOW rather than a third shade, because the
  // difference from published is not one of loudness: a filled dot is a fact,
  // an outline is an intention. Shading it would have said "slightly less
  // published", which is not what a draft with a planned date is.
  //
  // Reaches the calendar from 0074 onwards, when a draft can carry planned_for.
  draft: "border border-foreground/60 bg-transparent",
};

// An item plus the parts only the module can supply.
export type CalendarEntry = CalendarItem & {
  // A second line in the day detail: platforms for social, status for blog.
  meta?: string | null;
  // Module-specific buttons, rendered on the server and passed through.
  actions?: ReactNode;
};

function Dot({ status }: { status: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        DOT[status] ?? "bg-muted-foreground"
      )}
    />
  );
}

function Thumb({ src, size }: { src: string | null; size: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={cn("shrink-0 rounded-sm object-cover", size)}
    />
  ) : (
    <span className={cn("shrink-0 rounded-sm bg-muted", size)} />
  );
}

// One chip in a grid cell. Deliberately small: a dot, a thumbnail and a time is
// all that fits honestly at this size, and the day detail carries the rest.
function Chip({ entry }: { entry: CalendarEntry }) {
  const inner = (
    <>
      <Dot status={entry.status} />
      <Thumb src={entry.thumbnail} size="size-5" />
      <span className="truncate tabular-nums">{entry.time}</span>
    </>
  );
  const className = "flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-xs";

  return entry.href ? (
    <Link
      href={entry.href}
      title={entry.label}
      className={cn(className, "hover:bg-muted")}
    >
      {inner}
    </Link>
  ) : (
    <span title={entry.label} className={className}>
      {inner}
    </span>
  );
}

// One row in the day detail and in the agenda: the full label, the time, the
// module's meta line and its actions. This is where everything a cell cannot
// show ends up.
function DetailRow({ entry }: { entry: CalendarEntry }) {
  const body = (
    <>
      <Thumb src={entry.thumbnail} size="size-10" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <Dot status={entry.status} />
          <span className="text-xs text-muted-foreground tabular-nums">
            {entry.time}
          </span>
          {entry.meta ? (
            <span className="truncate text-xs text-muted-foreground capitalize">
              {entry.meta}
            </span>
          ) : null}
        </span>
        <span className="line-clamp-2 text-sm">
          {entry.label || (
            <span className="text-muted-foreground">No caption</span>
          )}
        </span>
      </span>
    </>
  );

  return (
    <li className="flex items-start gap-2 rounded-md border p-2">
      {entry.href ? (
        <Link
          href={entry.href}
          className="flex min-w-0 flex-1 items-start gap-2 hover:opacity-80"
        >
          {body}
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-start gap-2">{body}</span>
      )}
      {entry.actions ? (
        <span className="flex shrink-0 items-center gap-0.5">
          {entry.actions}
        </span>
      ) : null}
    </li>
  );
}

function DayList({ entries }: { entries: CalendarEntry[] }) {
  return (
    <ul className="space-y-2">
      {entries.map((entry) => (
        <DetailRow key={entry.id} entry={entry} />
      ))}
    </ul>
  );
}

export function MonthCalendar({
  entries,
  month,
  today,
  // Built by the caller, because a function cannot cross the server/client
  // boundary and each module owns its own URL shape.
  monthHref,
  emptyMessage,
}: {
  entries: CalendarEntry[];
  month: string;
  today: string; // London YYYY-MM-DD
  monthHref: { prev: string; next: string };
  emptyMessage: string;
}) {
  const grid = monthGrid(month);
  const byDay = bucketByDay(entries);
  const agenda = agendaDays(entries, today);

  return (
    <div className="space-y-3">
      {/* Grid only. The agenda is not month-scoped -- it lists everything from
          today forward, which is the useful thing on a phone -- so a "July 2026"
          heading with an August entry under it would be a contradiction. Day
          headings in the agenda name their own month instead. */}
      <div className="hidden items-center justify-between gap-2 sm:flex">
        <p className="text-sm font-medium">{grid.label}</p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous month"
            title="Previous month"
            render={<Link href={monthHref.prev} />}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next month"
            title="Next month"
            render={<Link href={monthHref.next} />}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      {/* Agenda: phones only. Upcoming days from today, no horizontal scroll. */}
      <div className="space-y-4 sm:hidden">
        {agenda.length === 0 ? (
          <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        ) : (
          agenda.map((day) => (
            <section key={day.date} className="space-y-1.5">
              <h3
                className={cn(
                  "text-xs font-medium",
                  day.date === today ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {formatDayLabel(day.date)}
                {day.date === today ? " · today" : ""}
              </h3>
              <DayList entries={day.items} />
            </section>
          ))
        )}
      </div>

      {/* Grid: sm and up. No min-width, so it fits its container rather than
          forcing the page to scroll sideways. */}
      <div className="hidden overflow-hidden rounded-card border sm:block">
        <div className="grid grid-cols-7 gap-px bg-border">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="bg-card px-2 py-1.5 text-xs font-medium text-muted-foreground"
            >
              {day}
            </div>
          ))}
          {grid.cells.map((cell, index) => {
            if (!cell) {
              return <div key={index} className="min-h-28 bg-card/50" />;
            }
            const dayEntries = byDay.get(cell.dayKey) ?? [];
            const overflowing = dayEntries.length > VISIBLE_CHIPS;
            const shown = overflowing
              ? dayEntries.slice(0, CHIPS_WITH_OVERFLOW)
              : dayEntries;
            const hidden = dayEntries.length - shown.length;
            const dayLabel = formatDayLabel(cell.dayKey);

            return (
              <div
                key={index}
                className={cn(
                  "min-h-28 space-y-1 bg-card p-1",
                  cell.dayKey === today && "ring-1 ring-primary ring-inset"
                )}
              >
                {/* The day number opens the detail whenever there is anything
                    to open, so the actions are reachable even on a day that
                    fits without an overflow row. */}
                {dayEntries.length > 0 ? (
                  <DayDetail
                    title={dayLabel}
                    triggerLabel={`${dayLabel}: ${dayEntries.length} item${dayEntries.length === 1 ? "" : "s"}`}
                    triggerClassName="ml-auto block px-1 text-xs text-muted-foreground tabular-nums hover:text-foreground"
                    trigger={cell.dayNum}
                  >
                    <DayList entries={dayEntries} />
                  </DayDetail>
                ) : (
                  <p className="px-1 text-right text-xs text-muted-foreground tabular-nums">
                    {cell.dayNum}
                  </p>
                )}

                {shown.map((entry) => (
                  <Chip key={entry.id} entry={entry} />
                ))}

                {hidden > 0 ? (
                  <DayDetail
                    title={dayLabel}
                    triggerLabel={`Show all ${dayEntries.length} on ${dayLabel}`}
                    triggerClassName="block w-full px-1 text-left text-xs text-muted-foreground hover:text-foreground"
                    trigger={`+${hidden} more`}
                  >
                    <DayList entries={dayEntries} />
                  </DayDetail>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
