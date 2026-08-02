import Link from "next/link";
import { ExternalLink, Pencil, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { londonParts } from "@/lib/social/london";
import { monthGrid } from "@/lib/calendar/grid";
import {
  MonthCalendar,
  type CalendarEntry,
} from "@/components/calendar/month-calendar";
import {
  UndatedDrafts,
  type UndatedDraft,
} from "@/components/calendar/undated-drafts";
import { publishPost, unpublishPost } from "@/lib/posts/actions";
import { shareToSocial } from "@/lib/social/actions";
import { ShareToSocialButton } from "@/components/share-to-social-button";
import { PostDeleteButton } from "@/components/post-delete-button";

export type CalendarBlogPost = {
  id: string;
  title: string;
  status: string;
  published_at: string | null;
  planned_for: string | null;
  featured_image: string | null;
};

// Blog's adapter onto the shared calendar, the sibling of social-calendar.tsx.
// Everything module-specific is here; the grid, the agenda and the day detail
// are shared and know none of it.

// Where a post sits, and it is deliberately two different kinds of date.
//
// A PUBLISHED post sits on published_at -- an instant, so it is reduced to a
// London wall-clock day like everything else in this codebase.
//
// A DRAFT sits on planned_for (0074), which is a plain date with no time and no
// timezone: an intention is "the 12th", not "the 12th at 09:00 UTC". It is
// already the string the calendar buckets by, so it needs no conversion, and
// converting it would be the bug.
//
// A draft with no planned date has nowhere to go and never appears. That is why
// the status tabs stay: today every one of this operator's drafts is dateless,
// so the list is the only place they exist.
function placement(
  post: CalendarBlogPost
): { date: string; time: string } | null {
  if (post.status === "published") {
    return post.published_at ? londonParts(post.published_at) : null;
  }
  // No time component, and none invented. The shared chip falls back to the
  // title rather than printing a fictional 00:00.
  return post.planned_for ? { date: post.planned_for, time: "" } : null;
}

// Exported so the combined client calendar builds blog entries the same way
// this module's own calendar does, rather than growing a second, drifting copy
// of what a blog post looks like on a grid.
//
// withModule tags each entry for the combined view's colour coding and day
// detail grouping. Off here: "Blog" on every tile of the blog calendar is noise.
export function blogEntries(
  posts: CalendarBlogPost[],
  clientSlug: string,
  withModule = false
): CalendarEntry[] {
  const entries: CalendarEntry[] = [];

  for (const post of posts) {
    const at = placement(post);
    if (!at) continue;

    entries.push({
      ...(withModule ? { module: "blog" as const } : {}),
      id: post.id,
      date: at.date,
      time: at.time,
      label: post.title,
      status: post.status,
      thumbnail: post.featured_image,
      // Always openable, unlike social: editing a published blog post is
      // ordinary work, not a special case, and the editor handles both states.
      href: `/c/${clientSlug}/blog/${post.id}/edit`,
      meta: post.status === "published" ? "Published" : "Planned",
      // Already out, so it recedes against what is still to come.
      done: post.status === "published",
      // The same actions the card grid offers, so the calendar is not a
      // read-only downgrade. Server-rendered here and passed through the client
      // dialog untouched.
      actions: (
        <>
          {post.status === "published" ? (
            <>
              <form action={shareToSocial}>
                <input type="hidden" name="id" value={post.id} />
                <input type="hidden" name="client_slug" value={clientSlug} />
                <ShareToSocialButton title={post.title} />
              </form>
              <form action={unpublishPost}>
                <input type="hidden" name="id" value={post.id} />
                <input type="hidden" name="client_slug" value={clientSlug} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Unpublish "${post.title}"`}
                  title="Unpublish"
                >
                  <Undo2 />
                </Button>
              </form>
            </>
          ) : (
            <form action={publishPost}>
              <input type="hidden" name="id" value={post.id} />
              <input type="hidden" name="client_slug" value={clientSlug} />
              <Button
                type="submit"
                variant="ghost"
                size="icon-sm"
                aria-label={`Publish "${post.title}"`}
                title="Publish"
              >
                <Send />
              </Button>
            </form>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Preview "${post.title}"`}
            title="Preview"
            render={<Link href={`/c/${clientSlug}/blog/${post.id}/preview`} />}
          >
            <ExternalLink />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit "${post.title}"`}
            title="Edit"
            render={<Link href={`/c/${clientSlug}/blog/${post.id}/edit`} />}
          >
            <Pencil />
          </Button>
          <PostDeleteButton postId={post.id} title={post.title} iconTrigger />
        </>
      ),
    });
  }

  return entries;
}

// A draft with no planned_for. placement() returns null for these, so the grid
// cannot draw them anywhere; the strip above the calendar is where they live.
function undatedDrafts(
  posts: CalendarBlogPost[],
  clientSlug: string
): UndatedDraft[] {
  return posts
    .filter((post) => post.status === "draft" && !post.planned_for)
    .map((post) => ({
      id: post.id,
      label: post.title,
      href: `/c/${clientSlug}/blog/${post.id}/edit`,
    }));
}

export function BlogCalendar({
  posts,
  clientSlug,
  month,
}: {
  posts: CalendarBlogPost[];
  clientSlug: string;
  month: string;
}) {
  const entries = blogEntries(posts, clientSlug);
  const { prevMonth, nextMonth } = monthGrid(month);
  const base = `/c/${clientSlug}/blog?view=calendar&month=`;

  return (
    <div className="space-y-3">
      <UndatedDrafts drafts={undatedDrafts(posts, clientSlug)} />
      <MonthCalendar
        entries={entries}
        month={month}
        today={londonParts(new Date().toISOString()).date}
        monthHref={{ prev: `${base}${prevMonth}`, next: `${base}${nextMonth}` }}
        emptyMessage="Nothing planned from today onwards. Give a draft a date to see it here."
        newPostHrefBase={`/c/${clientSlug}/blog/new?date=`}
      />
    </div>
  );
}
