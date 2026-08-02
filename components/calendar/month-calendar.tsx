import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DayCell } from "@/components/calendar/day-cell";
import {
  agendaDays,
  bucketByDay,
  formatDayLabel,
  monthGrid,
  mosaicLayout,
  type CalendarItem,
  type MosaicSpan,
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
// TWO LAYOUTS, ONE DATA SET. Above lg a month grid; below it an agenda. Both are
// rendered and toggled in CSS rather than through a media query hook, so there
// is no hydration mismatch and no layout flash on first paint.
//
// THE BREAKPOINT IS lg, NOT sm, and that was measured rather than guessed. A
// seven-column grid divides the viewport by seven and a quartered cell halves it
// again, so the tile width is roughly viewport/14. At 660px that is a 42px tile
// whose label box measures 24px -- about three characters, which is not a label.
// At 1024px the tile is ~68px and the two lines of text land. Below lg the
// agenda is simply the better shape, which is why it exists.
//
// The cost: a tablet no longer gets the month grid. That is deliberate. A grid
// too small to read is worse than a list, and the previous version's answer --
// min-w-[640px] inside overflow-x-auto -- just made you side-scroll it.

// Cell height, and the number this whole layout stands or falls on.
//
// A quartered cell divides this by two, so 36 (144px) gives each quarter ~71px
// of height: enough for a recognisable image with two lines of 11px text over
// it. At the previous 28 (112px) a quarter was 55px, where the gradient and two
// text lines leave almost no picture, and the tiles stop being worth having.
//
// The cost is real and worth stating: a six-week month is now roughly 900px of
// grid rather than 700. That does not fit one screen, and it is the deliberate
// trade -- this view exists to be looked at rather than counted.
const CELL_HEIGHT = "min-h-36";

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
  // What a grid tile shows over the image, when the full label is too long for
  // it. Blog omits this: a title already fits. Social sets the opening words of
  // the caption, which runs to paragraphs.
  //
  // Neither shows a TIME any more. A planned blog draft has a date and no time
  // at all, so a tile reading "00:00" would invent precision the data does not
  // have; the time lives in the day detail, where there is room for it.
  chipLabel?: string | null;
  // A second line in the day detail: platforms for social, status for blog.
  meta?: string | null;
  // Which module this came from, on the combined client calendar. Undefined on
  // a single-module calendar, where saying "Blog" on every tile of the blog
  // calendar would be noise.
  module?: "blog" | "social";
  // Module-specific buttons, rendered on the server and passed through.
  actions?: ReactNode;
  // Already out: a published blog post, a posted social post. Set by the module,
  // because "has this gone out" is a lifecycle question and the calendar does not
  // know any module's lifecycle. Note that a PARTIAL social post is deliberately
  // not done -- some targets failed, so it still needs someone.
  done?: boolean;
};

// MODULE COLOUR, and it deliberately does not touch the dots.
//
// The dot already carries calendar emphasis (loud for what has not happened,
// quiet for what has). Overloading it with module would cost the distinction
// that emphasis exists for. So module is a separate channel: an accent strip
// down the edge of a tile, plus a named heading in the day detail, plus a
// legend. Colour is never the only carrier.
const MODULE_ACCENT: Record<string, string> = {
  blog: "bg-primary",
  social: "bg-counter-ok",
};
const MODULE_LABEL: Record<string, string> = {
  blog: "Blog",
  social: "Social",
};

function Dot({ status, onImage }: { status: string; onImage?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-1 size-1.5 shrink-0 rounded-full",
        // Over a photo the palette dots lose their meaning: a muted brown on a
        // dark gradient is invisible, and the point of the dot is the
        // planned-versus-published distinction. White fill for a fact, white
        // outline for an intention, which is the same grammar as the palette
        // version and survives any photo underneath.
        onImage
          ? status === "draft"
            ? "border border-white/80 bg-transparent"
            : "bg-white/80"
          : DOT[status] ?? "bg-muted-foreground"
      )}
    />
  );
}

function Thumb({
  src,
  size,
  done,
}: {
  src: string | null;
  size: string;
  done?: boolean;
}) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={cn(
        "shrink-0 rounded-sm object-cover",
        size,
        done && "opacity-45 saturate-50"
      )}
    />
  ) : (
    <span className={cn("shrink-0 rounded-sm bg-muted", size)} />
  );
}

// One post as a TILE filling its share of a day cell.
//
// The image is the content, not a decoration beside it: at a glance a month
// should read as the pictures going out, and a 20px thumbnail beside a timestamp
// never did that. So the picture fills the tile and the words sit on top.
//
// TWO TREATMENTS, not one. Over a photo the label needs a dark gradient to stay
// legible against whatever the photo happens to be, and white text on that
// gradient is readable over anything. Without a photo there is nothing to fight,
// so the tile is a plain neutral panel with ordinary foreground text -- forcing
// white-on-muted there would be worse in both themes for no reason. A post with
// no image is never a gap.
const SPAN_CLASS: Record<MosaicSpan, string> = {
  full: "col-span-2 row-span-2",
  wide: "col-span-2",
  quarter: "",
};

// WHAT "DONE" LOOKS LIKE, and why it is not just lower opacity on the whole tile.
//
// Fading a tile wholesale fades its text too, and a month you cannot read is not
// a calendar. So the PICTURE recedes -- dimmed and desaturated, which is what
// carries the visual weight -- while the label stays legible, one step down
// rather than ten. Done work should be quiet, not illegible.
const DONE_IMAGE = "opacity-45 saturate-50";

function Tile({ entry, span }: { entry: CalendarEntry; span: MosaicSpan }) {
  const label = entry.chipLabel ?? entry.label;
  const hasImage = Boolean(entry.thumbnail);
  const done = Boolean(entry.done);

  const accent = entry.module ? MODULE_ACCENT[entry.module] : null;

  const inner = (
    <>
      {/* Full-height strip down the leading edge. Above the photo, outside the
          gradient, so it reads at any tile size and against any image. */}
      {accent ? (
        <span
          aria-hidden="true"
          className={cn("absolute inset-y-0 left-0 z-10 w-1", accent)}
        />
      ) : null}
      {hasImage ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={entry.thumbnail!}
            alt=""
            className={cn(
              "absolute inset-0 size-full object-cover",
              done && DONE_IMAGE
            )}
          />
          <span
            className={cn(
              "absolute inset-x-0 bottom-0 px-1 pt-3 pb-1",
              // A dimmed photo needs less gradient to sit text on, and piling
              // the full one on top would make an already-recessive tile read as
              // a dark smear.
              done
                ? "bg-gradient-to-t from-black/60 to-transparent"
                : "bg-gradient-to-t from-black/85 via-black/50 to-transparent"
            )}
          >
            <span className="flex items-start gap-1">
              <Dot status={entry.status} onImage />
              <span
                className={cn(
                  "line-clamp-2 text-[11px] leading-tight",
                  done ? "text-white/60" : "text-white"
                )}
              >
                {label}
              </span>
            </span>
          </span>
        </>
      ) : (
        /* The ring is load-bearing, not decoration: bg-muted sits so close to
           bg-card in the dark theme that without an edge the tile reads as empty
           space with text floating in it, rather than as a post that happens to
           have no picture. Absence has to look deliberate. */
        <span
          className={cn(
            "absolute inset-0 flex items-end rounded-sm px-1 pb-1 ring-1 ring-border ring-inset",
            done ? "bg-muted/40" : "bg-muted"
          )}
        >
          <span className="flex items-start gap-1">
            <Dot status={entry.status} />
            <span
              className={cn(
                "line-clamp-3 text-[11px] leading-tight",
                done && "text-muted-foreground"
              )}
            >
              {label}
            </span>
          </span>
        </span>
      )}
    </>
  );

  const className = cn(
    "relative overflow-hidden rounded-sm bg-card",
    SPAN_CLASS[span]
  );

  return entry.href ? (
    <Link
      href={entry.href}
      title={entry.label}
      className={cn(className, "transition-opacity hover:opacity-80")}
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
  const done = Boolean(entry.done);
  const body = (
    <>
      <Thumb src={entry.thumbnail} size="size-10" done={done} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <Dot status={entry.status} />
          {entry.time ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {entry.time}
            </span>
          ) : null}
          {entry.meta ? (
            <span className="truncate text-xs text-muted-foreground capitalize">
              {entry.meta}
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            "line-clamp-2 text-sm",
            // The row still has to be readable enough to act on -- the actions
            // for a published post live right beside it -- so this is one step
            // back, not a fade-out.
            done && "text-muted-foreground"
          )}
        >
          {entry.label || (
            <span className="text-muted-foreground">No caption</span>
          )}
        </span>
      </span>
    </>
  );

  return (
    <li
      className={cn(
        "flex items-start gap-2 rounded-md border p-2",
        done && "bg-muted/20"
      )}
    >
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

// GROUPED BY MODULE when a day holds both, flat when it holds one.
//
// Blog and social do not offer the same actions -- blog has share, publish,
// preview; social has cancel -- so an ungrouped day would put two different icon
// vocabularies in adjacent rows and make you read each one to know which set you
// were looking at. A heading answers that once for the whole group.
//
// Flat when there is only one module, because "Blog" above a list of only blog
// posts is a label nobody needed.
function DayList({ entries }: { entries: CalendarEntry[] }) {
  const modules = [...new Set(entries.map((entry) => entry.module).filter(Boolean))];

  if (modules.length < 2) {
    return (
      <ul className="space-y-2">
        {entries.map((entry) => (
          <DetailRow key={entry.id} entry={entry} />
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-3">
      {modules.map((module) => (
        <section key={module} className="space-y-1.5">
          <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "size-2 rounded-sm",
                MODULE_ACCENT[module as string] ?? "bg-muted-foreground"
              )}
            />
            {MODULE_LABEL[module as string] ?? module}
          </h4>
          <ul className="space-y-2">
            {entries
              .filter((entry) => entry.module === module)
              .map((entry) => (
                <DetailRow key={entry.id} entry={entry} />
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// Shown only on a calendar that actually mixes modules, so a single-module
// calendar is not carrying a legend explaining one thing.
function Legend({ entries }: { entries: CalendarEntry[] }) {
  const modules = [...new Set(entries.map((entry) => entry.module).filter(Boolean))];
  if (modules.length < 2) return null;
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      {modules.map((module) => (
        <span key={module} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn(
              "size-2 rounded-sm",
              MODULE_ACCENT[module as string] ?? "bg-muted-foreground"
            )}
          />
          {MODULE_LABEL[module as string] ?? module}
        </span>
      ))}
    </div>
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
  newPostHrefBase,
}: {
  entries: CalendarEntry[];
  month: string;
  today: string; // London YYYY-MM-DD
  monthHref: { prev: string; next: string };
  emptyMessage: string;
  // A URL with the day appended, e.g. "/c/acme/blog/new?date=". A base rather
  // than a function because a function cannot cross into the client cell, and
  // each module owns its own URL shape - the same reason monthHref is built by
  // the caller.
  //
  // Omitted by the combined client calendar, which spans blog and social and so
  // has no single answer to what "new post" means. There the day dialog is the
  // read-only thing it has always been.
  newPostHrefBase?: string;
}) {
  const newPostHref = (day: string) =>
    newPostHrefBase ? `${newPostHrefBase}${day}` : undefined;
  const grid = monthGrid(month);
  const byDay = bucketByDay(entries);
  const agenda = agendaDays(entries, today);

  return (
    <div className="space-y-3">
      {/* Grid only. The agenda is not month-scoped -- it lists everything from
          today forward, which is the useful thing on a phone -- so a "July 2026"
          heading with an August entry under it would be a contradiction. Day
          headings in the agenda name their own month instead. */}
      <div className="hidden items-center justify-between gap-2 lg:flex">
        <div className="flex items-center gap-4">
          <p className="text-sm font-medium">{grid.label}</p>
          <Legend entries={entries} />
        </div>
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
      <div className="space-y-4 lg:hidden">
        <Legend entries={entries} />
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
              {/* Below lg there is no grid, so there is no cell to click. The
                  day heading is the only thing standing in for a day, so the
                  affordance hangs off that instead. */}
              {newPostHrefBase ? (
                <Link
                  href={newPostHref(day.date)!}
                  className="flex items-center gap-1.5 rounded-md border border-dashed p-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                  New post on this day
                </Link>
              ) : null}
              <DayList entries={day.items} />
            </section>
          ))
        )}
      </div>

      {/* Grid: sm and up. No min-width, so it fits its container rather than
          forcing the page to scroll sideways. */}
      <div className="hidden overflow-hidden rounded-card border lg:block">
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
              return <div key={index} className={cn(CELL_HEIGHT, "bg-card/50")} />;
            }
            const dayEntries = byDay.get(cell.dayKey) ?? [];
            const mosaic = mosaicLayout(dayEntries.length);
            const dayLabel = formatDayLabel(cell.dayKey);

            return (
              <DayCell
                key={index}
                dayLabel={dayLabel}
                dayNum={cell.dayNum}
                isToday={cell.dayKey === today}
                count={dayEntries.length}
                newPostHref={newPostHref(cell.dayKey)}
                className={CELL_HEIGHT}
                dayList={<DayList entries={dayEntries} />}
                mosaic={
                  // Absolute inside the cell, so the tiles get the whole of it
                  // and the mosaic is not pushed down by a header row.
                  //
                  // The +N tile is now a plain marker rather than its own
                  // dialog trigger: the whole cell opens the day, so a second
                  // trigger inside it would be a button inside a button.
                  mosaic.spans.length > 0 ? (
                    <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-px p-px">
                      {dayEntries.slice(0, mosaic.shown).map((entry, slot) => (
                        <Tile
                          key={entry.id}
                          entry={entry}
                          span={mosaic.spans[slot]}
                        />
                      ))}
                      {mosaic.overflow > 0 ? (
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex items-center justify-center rounded-sm bg-muted text-xs font-medium text-muted-foreground",
                            SPAN_CLASS[mosaic.spans[mosaic.spans.length - 1]]
                          )}
                        >
                          +{mosaic.overflow}
                        </span>
                      ) : null}
                    </div>
                  ) : null
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
