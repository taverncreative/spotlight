import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// The pinboard tile every Overview panel is built from.
//
// The Overview used to be a linear scroll: sites, then posts, then API keys, one
// after another, so finding anything meant reading everything. It is now a grid
// of panels, each a snippet of one module with a way through to it.
//
// Every panel is READ-ONLY on purpose. A dashboard that also acts has two jobs
// and does the second one badly, in a box too small to confirm anything; the
// heading link is the way to act.
export function Panel({
  title,
  href,
  hint,
  wide,
  children,
}: {
  title: string;
  // Where the panel's module lives. The whole heading is the link, so the
  // target is a comfortable size rather than a chevron you have to hit.
  href: string;
  // A number or short phrase beside the title: "9 scheduled", "2 overdue".
  hint?: string;
  // Panels carrying images need width; everything else is one column.
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-card border bg-card p-4",
        wide && "sm:col-span-2"
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <Link
          href={href}
          className="group inline-flex items-center gap-1 text-sm font-medium"
        >
          {title}
          <ChevronRight
            aria-hidden="true"
            className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          />
        </Link>
        {hint ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

// What a panel says when it has nothing. Used only by Blog and Social: for those
// two, "no posts yet" on a client you blog for IS the signal, and they are the
// board's visual anchors, so hiding them would collapse it to almost nothing.
// Tasks, Requests, Retainer and Site health hide instead, because their absence
// is not interesting.
export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

// A square image tile, the unit both visual panels are built from. Falls back to
// the title on a muted tile so a post without an image leaves no hole in the
// grid.
export function Thumb({
  src,
  label,
  caption,
}: {
  src: string | null;
  label: string;
  caption?: string | null;
}) {
  return (
    <div className="space-y-1">
      <div className="relative aspect-square overflow-hidden rounded-control bg-muted">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center p-2 text-center text-[0.65rem] leading-tight text-muted-foreground">
            {label}
          </span>
        )}
      </div>
      {caption ? (
        <p className="truncate text-[0.7rem] text-muted-foreground">
          {caption}
        </p>
      ) : null}
    </div>
  );
}
