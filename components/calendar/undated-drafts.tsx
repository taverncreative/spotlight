import Link from "next/link";
import { CalendarPlus } from "lucide-react";

// Drafts with no date, sitting above the calendar that structurally cannot show
// them.
//
// WHY THIS HAD TO EXIST BEFORE THE CALENDAR COULD BE THE DEFAULT VIEW. A month
// grid buckets by day. A draft with no day has no bucket, so it does not appear
// - not because it was filtered out, but because there is nowhere to draw it.
// While the list was the default that was survivable: the drafts were on the
// screen you landed on. Making the calendar the default without this would have
// meant opening a module and seeing none of its dateless work, which reads as
// data loss rather than as a view that cannot hold it.
//
// So the strip is not a nicety attached to this slice. It is the thing that
// makes the default flip honest.
//
// Deliberately a strip and not a grid: these are unfinished and undated, which
// is a queue to work through, not a gallery to admire.
export type UndatedDraft = {
  id: string;
  label: string;
  href: string;
};

export function UndatedDrafts({
  drafts,
  // "Give it a date" needs somewhere to go, and that is just the editor, which
  // is where the date field lives. Same href as the label, kept separate so a
  // module could route it elsewhere later.
  noun = "draft",
}: {
  drafts: UndatedDraft[];
  noun?: string;
}) {
  if (drafts.length === 0) return null;

  return (
    <section className="space-y-2 rounded-card border border-dashed bg-card/50 p-3">
      <div className="flex items-center gap-2">
        <CalendarPlus className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-medium">
          Undated {noun}
          {drafts.length === 1 ? "" : "s"}
          <span className="ml-1.5 text-muted-foreground">{drafts.length}</span>
        </h2>
        <p className="text-xs text-muted-foreground">
          No date, so nowhere on the calendar.
        </p>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {drafts.map((draft) => (
          <li key={draft.id}>
            <Link
              href={draft.href}
              className="inline-flex max-w-[18rem] items-center rounded-pill border bg-card px-2.5 py-1 text-xs transition-colors hover:bg-accent"
            >
              <span className="truncate">
                {draft.label || (
                  <span className="text-muted-foreground">Untitled</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
