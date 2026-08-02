"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// One day cell in the month grid, and the only interactive island in it.
//
// It owns open state and nothing else. The mosaic of tiles and the day's detail
// list both arrive as children, already rendered on the server, so this
// component still knows nothing about posts, captions or platforms - the same
// contract DayDetail has always had.
//
// TWO TRIGGERS, ONE DIALOG. The day number opens it, and so does the empty
// space of the cell. That second one is the point of this slice: a day you can
// see is empty should be a day you can click, rather than one that sends you to
// a New post button at the top of the page and asks you to retype a date you
// were already pointing at.
//
// THE TILES ARE NOT A TRIGGER. They sit above this button in the stack and
// carry their own links, so clicking a post still opens that post. The button
// is genuinely only the space around them, which is why it is a sibling
// underneath rather than a wrapper: a wrapper would swallow every tile click
// and need each tile to stop propagation, and one missed stopPropagation would
// silently make a post unopenable.
export function DayCell({
  dayLabel,
  dayNum,
  isToday,
  count,
  // Where "New post on this day" goes. Absent on a calendar that has no single
  // answer to what a new post IS - the combined client calendar spans two
  // modules - and then the cell behaves exactly as it did before this existed.
  newPostHref,
  className,
  mosaic,
  dayList,
}: {
  dayLabel: string;
  dayNum: number;
  isToday: boolean;
  count: number;
  newPostHref?: string;
  className?: string;
  mosaic: ReactNode;
  dayList: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // Nothing to open: no new-post target and no posts to list. Renders exactly
  // the inert cell the calendar had before.
  const interactive = Boolean(newPostHref) || count > 0;

  return (
    <div
      className={cn(
        "relative bg-card",
        // TODAY IS A NEUTRAL RING, not the brand terracotta. It marks POSITION,
        // not importance, and blog tiles already carry a terracotta accent
        // strip, so a terracotta ring put two marks of one colour in a cell
        // meaning different things. Not ring-ring either: --ring is aliased to
        // --brand, so it is the same colour under another name.
        isToday && "ring-1 ring-muted-foreground ring-inset",
        className
      )}
    >
      {/* The background trigger, beneath everything. Sized to the whole cell so
          any gap between tiles works, and on an empty day that is all of it. */}
      {interactive ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={
            count > 0
              ? `${dayLabel}: ${count} item${count === 1 ? "" : "s"}`
              : `${dayLabel}: add a post`
          }
          className="absolute inset-0 z-0 cursor-pointer rounded-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        />
      ) : null}

      {/* Tiles, above the background trigger, keeping their own links. */}
      {mosaic ? (
        <div className="pointer-events-none absolute inset-0 z-10">
          {/* The wrapper is transparent to the mouse so the gaps between tiles
              fall through to the button; each tile turns pointer events back on
              for itself. */}
          <div className="pointer-events-none size-full [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
            {mosaic}
          </div>
        </div>
      ) : null}

      {/* The day number sits ON the mosaic, so it needs its own backdrop to stay
          readable over a photo. */}
      {interactive ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={
            count > 0
              ? `${dayLabel}: ${count} item${count === 1 ? "" : "s"}`
              : `${dayLabel}: add a post`
          }
          className="absolute top-1 right-1 z-20 cursor-pointer rounded bg-background/75 px-1 text-xs tabular-nums backdrop-blur-xs outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
        >
          {dayNum}
        </button>
      ) : (
        <p className="absolute top-1 right-1 z-20 text-xs text-muted-foreground tabular-nums">
          {dayNum}
        </p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
          <DialogTitle>{dayLabel}</DialogTitle>
          <div className="space-y-3">
            {newPostHref ? (
              <Link
                href={newPostHref}
                className="flex items-center gap-2 rounded-md border border-dashed p-2.5 text-sm font-medium transition-colors hover:bg-accent"
              >
                <Plus className="size-4" />
                New post on this day
              </Link>
            ) : null}
            {count > 0 ? dayList : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
