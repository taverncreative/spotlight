import Link from "next/link";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { coverImageUrl } from "@/lib/social/media-paths";
import { londonParts } from "@/lib/social/london";
import { firstWords, monthGrid } from "@/lib/calendar/grid";
import {
  MonthCalendar,
  type CalendarEntry,
} from "@/components/calendar/month-calendar";
import { SocialCancelButton } from "@/components/social/social-cancel-button";
import { SocialDeleteButton } from "@/components/social/social-delete-button";

export type CalendarPost = {
  id: string;
  caption: string;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  social_post_media: {
    position: number;
    storage_path: string;
    media_type?: string | null;
    poster_path?: string | null;
  }[];
  social_post_targets?: {
    meta_accounts: { platform: string } | null;
  }[];
};

// Social's adapter onto the shared calendar. Everything module-specific lives
// here -- which instant a post sits on, which statuses can still be opened, what
// the action buttons are -- and the calendar itself knows none of it. That is
// the whole point of the split: blog will add a sibling of this file and share
// every line of the grid, the agenda and the day detail.

// The instant that places a post: published posts sit on their published date,
// everything else in the schedule lifecycle (scheduled, publishing, failed,
// partial) on its scheduled slot. Drafts have no date and never appear, which is
// exactly why the status tabs have to survive the calendar becoming the default
// view -- a dateless draft is reachable nowhere else, and twelve of this
// client's twenty-nine posts are drafts.
function calendarInstant(post: CalendarPost): string | null {
  if (post.status === "published") return post.published_at;
  if (post.status === "draft") return null;
  return post.scheduled_at;
}

// Failed and partial link to the edit page like scheduled does; the edit page
// shows its own "no longer editable" notice for them. Published and publishing
// are inert -- there is nothing left to change.
const LINKABLE = new Set(["scheduled", "failed", "partial"]);

// Exported for the combined client calendar, for the same reason blogEntries is:
// one definition of what a social post looks like on a grid, not two.
export function socialEntries(
  posts: CalendarPost[],
  clientSlug: string,
  withModule = false
): CalendarEntry[] {
  const entries: CalendarEntry[] = [];

  for (const post of posts) {
    const iso = calendarInstant(post);
    if (!iso) continue;

    const { date, time } = londonParts(iso);
    const cover = (post.social_post_media ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)[0];
    const platforms = Array.from(
      new Set(
        (post.social_post_targets ?? [])
          .map((target) => target.meta_accounts?.platform)
          .filter((platform): platform is string => !!platform)
      )
    );
    const editable = post.status === "draft" || post.status === "scheduled";

    entries.push({
      ...(withModule ? { module: "social" as const } : {}),
      id: post.id,
      date,
      time,
      label: post.caption,
      // The opening words rather than the time, matching blog showing titles. A
      // caption runs to paragraphs where a title does not, so it is cut on a
      // word boundary; the time still shows in the day detail, where there is
      // room for it.
      chipLabel: firstWords(post.caption, 6) || "No caption",
      status: post.status,
      thumbnail: cover ? coverImageUrl(cover) : null,
      href: LINKABLE.has(post.status)
        ? `/c/${clientSlug}/social/${post.id}/edit`
        : null,
      meta: platforms.length ? platforms.join(", ") : "No targets",
      // Already out. NOT partial: some of its targets failed, so it still needs
      // someone and must not recede with the finished work.
      done: post.status === "published",
      // The same actions the card grid offers, so moving the calendar to the
      // front is not a read-only downgrade. Rendered on the server here and
      // handed through the client dialog untouched.
      actions: (
        <>
          {post.status === "scheduled" ? (
            <SocialCancelButton postId={post.id} iconTrigger />
          ) : null}
          {editable ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Edit post"
              title="Edit"
              render={<Link href={`/c/${clientSlug}/social/${post.id}/edit`} />}
            >
              <Pencil />
            </Button>
          ) : null}
          <SocialDeleteButton postId={post.id} iconTrigger />
        </>
      ),
    });
  }

  return entries;
}

export function SocialCalendar({
  posts,
  clientSlug,
  month,
}: {
  posts: CalendarPost[];
  clientSlug: string;
  month: string;
}) {
  const entries = socialEntries(posts, clientSlug);
  // monthGrid is the single place that knows how a month rolls over a year
  // boundary; this only borrows the two neighbours to build hrefs.
  const { prevMonth, nextMonth } = monthGrid(month);
  const base = `/c/${clientSlug}/social?view=calendar&month=`;

  return (
    <MonthCalendar
      entries={entries}
      month={month}
      today={londonParts(new Date().toISOString()).date}
      monthHref={{ prev: `${base}${prevMonth}`, next: `${base}${nextMonth}` }}
      emptyMessage="Nothing scheduled from today onwards. Drafts live under the Drafts tab."
    />
  );
}
