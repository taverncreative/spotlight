import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { socialMediaPublicUrl } from "@/lib/social/media-paths";
import { londonParts } from "@/lib/social/london";

export type CalendarPost = {
  id: string;
  caption: string;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  social_post_media: { position: number; storage_path: string }[];
};

// The instant that places a post on the calendar: published posts sit on their
// published date, everything else in the schedule lifecycle (scheduled,
// publishing, failed, partial) on its scheduled slot. Drafts have no date and
// never appear.
function calendarInstant(post: CalendarPost): string | null {
  if (post.status === "published") return post.published_at;
  if (post.status === "draft") return null;
  return post.scheduled_at;
}

// Chip dot colour per status, on the same warm-bento tokens as StatusPill.
const DOT: Record<string, string> = {
  scheduled: "bg-status-info",
  publishing: "bg-status-warn",
  published: "bg-status-ok",
  partial: "bg-status-warn",
  failed: "bg-status-danger",
};

// Failed/partial link to the edit page like scheduled does; the edit page shows
// its own "no longer editable" notice for them. Published/publishing are inert.
const LINKABLE = new Set(["scheduled", "failed", "partial"]);

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Month view of the client's social posts, bucketed by Europe/London wall-clock
// date via londonParts -- never naive getDate/getMonth, which would misplace
// posts near midnight on Vercel's UTC runtime. The grid itself is pure calendar
// maths, so Date.UTC there is deterministic. `month` is a validated YYYY-MM.
export function SocialCalendar({
  posts,
  clientSlug,
  month,
}: {
  posts: CalendarPost[];
  clientSlug: string;
  month: string;
}) {
  const [year, monthNum] = month.split("-").map(Number);

  // Monday-first grid: leading blanks before the 1st, trailing to a full week.
  const firstDay = new Date(Date.UTC(year, monthNum - 1, 1));
  const leadingBlanks = (firstDay.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const cellCount = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;

  const monthLabel = firstDay.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const prevMonth =
    monthNum === 1
      ? `${year - 1}-12`
      : `${year}-${String(monthNum - 1).padStart(2, "0")}`;
  const nextMonth =
    monthNum === 12
      ? `${year + 1}-01`
      : `${year}-${String(monthNum + 1).padStart(2, "0")}`;

  const today = londonParts(new Date().toISOString()).date;

  // Bucket posts by London date, earliest time first within a day.
  const byDay = new Map<string, { post: CalendarPost; time: string }[]>();
  for (const post of posts) {
    const iso = calendarInstant(post);
    if (!iso) continue;
    const { date, time } = londonParts(iso);
    const entries = byDay.get(date) ?? [];
    entries.push({ post, time });
    byDay.set(date, entries);
  }
  for (const entries of byDay.values())
    entries.sort((a, b) => a.time.localeCompare(b.time));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{monthLabel}</p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous month"
            title="Previous month"
            render={
              <Link
                href={`/c/${clientSlug}/social?view=calendar&month=${prevMonth}`}
              />
            }
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next month"
            title="Next month"
            render={
              <Link
                href={`/c/${clientSlug}/social?view=calendar&month=${nextMonth}`}
              />
            }
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[640px] overflow-hidden rounded-card border">
          <div className="grid grid-cols-7 gap-px bg-border">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="bg-card px-2 py-1.5 text-xs font-medium text-muted-foreground"
              >
                {day}
              </div>
            ))}
            {Array.from({ length: cellCount }, (_, index) => {
              const dayNum = index - leadingBlanks + 1;
              if (dayNum < 1 || dayNum > daysInMonth) {
                return <div key={index} className="min-h-24 bg-card/50" />;
              }
              const dayKey = `${month}-${String(dayNum).padStart(2, "0")}`;
              const entries = byDay.get(dayKey) ?? [];
              const shown = entries.slice(0, 3);
              const overflow = entries.length - shown.length;
              return (
                <div
                  key={index}
                  className={cn(
                    "min-h-24 space-y-1 bg-card p-1",
                    dayKey === today && "ring-1 ring-primary ring-inset"
                  )}
                >
                  <p className="px-1 text-right text-xs text-muted-foreground tabular-nums">
                    {dayNum}
                  </p>
                  {shown.map(({ post, time }) => {
                    const cover = (post.social_post_media ?? [])
                      .slice()
                      .sort((a, b) => a.position - b.position)[0];
                    const chip = (
                      <>
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            DOT[post.status] ?? "bg-muted-foreground"
                          )}
                        />
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={socialMediaPublicUrl(cover.storage_path)}
                            alt=""
                            className="size-5 shrink-0 rounded-sm object-cover"
                          />
                        ) : (
                          <span className="size-5 shrink-0 rounded-sm bg-muted" />
                        )}
                        <span className="truncate tabular-nums">{time}</span>
                      </>
                    );
                    const chipClass =
                      "flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-xs";
                    return LINKABLE.has(post.status) ? (
                      <Link
                        key={post.id}
                        href={`/c/${clientSlug}/social/${post.id}/edit`}
                        title={post.caption || "No caption"}
                        className={cn(chipClass, "hover:bg-muted")}
                      >
                        {chip}
                      </Link>
                    ) : (
                      <span
                        key={post.id}
                        title={post.caption || "No caption"}
                        className={chipClass}
                      >
                        {chip}
                      </span>
                    );
                  })}
                  {overflow > 0 ? (
                    <Link
                      href={`/c/${clientSlug}/social`}
                      className="block px-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      +{overflow} more
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
