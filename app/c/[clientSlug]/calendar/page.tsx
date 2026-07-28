import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { londonMonth, monthGrid, parseMonth } from "@/lib/calendar/grid";
import { londonParts } from "@/lib/social/london";
import { MonthCalendar } from "@/components/calendar/month-calendar";
import { blogEntries, type CalendarBlogPost } from "@/components/blog/blog-calendar";
import { socialEntries, type CalendarPost } from "@/components/social/social-calendar";

// Everything going out for one client, blog and social on one grid.
//
// WHY THIS IS ITS OWN ROUTE rather than a panel on Overview or a tab inside
// either module. It belongs to neither: it exists to answer "is this client
// getting content this week", which is a question about the client, not about
// blog or about social. Putting it inside Blog would make it look like a blog
// feature that happens to show social; putting it on Overview would mean a month
// grid squeezed into a pinboard of small panels, which is the size problem the
// calendar work started from.
//
// The month grid, agenda, day detail and mosaic are all the shared component.
// The only thing this page adds is fetching two tables instead of one and asking
// the module adapters to tag their entries.
export default async function ClientCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { clientSlug } = await params;
  const { month: monthParam } = await searchParams;
  const { client } = await requireClient(clientSlug);
  const month = parseMonth(monthParam) ?? londonMonth(new Date().toISOString());

  const supabase = await createClient();
  const [posts, social] = await Promise.all([
    supabase
      .from("posts")
      .select("id, title, status, published_at, planned_for, featured_image")
      .eq("client_id", client.id),
    supabase
      .from("social_posts")
      .select(
        "id, caption, status, scheduled_at, published_at, social_post_media(position, storage_path, media_type, poster_path), social_post_targets(meta_accounts(platform))"
      )
      .eq("client_id", client.id),
  ]);

  // Built by the modules' own adapters, tagged with their module. One definition
  // of what each kind of post looks like on a grid, shared with the module
  // calendars rather than copied.
  const entries = [
    ...blogEntries((posts.data ?? []) as CalendarBlogPost[], clientSlug, true),
    ...socialEntries(
      (social.data ?? []) as unknown as CalendarPost[],
      clientSlug,
      true
    ),
  ];

  // monthGrid owns how a month rolls over a year boundary; this borrows the two
  // neighbours to build hrefs, exactly as the module calendars do.
  const { prevMonth, nextMonth } = monthGrid(month);
  const base = `/c/${clientSlug}/calendar?month=`;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Calendar</h1>
        <p className="text-sm text-muted-foreground">
          Everything going out for this client, blog and social together.
        </p>
      </div>

      <MonthCalendar
        entries={entries}
        month={month}
        today={londonParts(new Date().toISOString()).date}
        monthHref={{ prev: `${base}${prevMonth}`, next: `${base}${nextMonth}` }}
        emptyMessage="Nothing planned or scheduled from today onwards."
      />
    </div>
  );
}
