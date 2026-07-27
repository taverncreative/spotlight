import { createClient } from "@/lib/supabase/server";
import { ClientGrid } from "@/components/client-grid";
import type {
  BlogItem,
  ClientCardData,
  RequestItem,
  SocialItem,
  TaskItem,
  UnassignedCounts,
} from "@/lib/clients/counts";
import type { ClientRow } from "@/components/client-form-dialog";
import { assessSite } from "@/lib/sites/monitoring";
import { healthScore, type HealthInput } from "@/lib/clients/health";

// The operator home: a card per client, showing what is waiting, and expanding
// in place to show what that actually is.
//
// COUNTING STRATEGY. Six queries total regardless of client count, never one per
// client. Three of them (tasks, social, blog) select the few columns the
// expanded view needs, so opening a card costs no request at all: the detail is
// already on the page. The other two are count-only, because every request and
// print order is currently unlinked and has no client to expand under.
//
// Not a SQL view: PostgREST cannot GROUP BY, so that would be real schema, and
// at current volumes (about 50 rows across every table combined) folding in JS
// is free and needs no migration to undo.
//
// The ceiling worth knowing: supabase/config.toml sets max_rows = 1000, so each
// query silently truncates past a thousand matching rows and both counts and
// detail would quietly under-report. Nothing is near that. When any single
// filter approaches it, this is the point to swap the fold for a grouped view.
//
// deploy_hook_url is selected but never passed on: it is narrowed to a boolean
// below, before the row reaches a client component.
// The clients row as SELECTED, which carries more than the grid needs. services
// is read here to score health and then dropped; the deploy hook is not selected
// at all any more, because nothing on this page needs to know it exists.
type ClientConfigRow = ClientRow & { services: string[] | null };

// overdue is not selected; it is derived below from due_date against today.
type TaskRow = Omit<TaskItem, "overdue"> & { client_id: string | null };
type RequestRow = RequestItem & { client_id: string | null };
// summary/quantity/extraLines are built below from the embedded lines.
type PrintOrderRow = {
  id: string;
  client_id: string | null;
  ordered_at: string | null;
  created_at: string;
  print_order_items: { name: string; quantity: number; position: number }[];
};
type SocialRow = SocialItem & { client_id: string | null };
type BlogRow = BlogItem & { client_id: string | null };

// Built from a literal, not spread from an imported constant. That is what broke
// the counters: EMPTY_CARD_DATA's ancestor lived in the client component, so on
// the server it was a client reference, the spread produced {} and every ++
// produced NaN. A literal has nothing to substitute.
// The worst state across a client's monitored sites, in the shape the scorer
// takes. "unknown" means never checked, which is excluded rather than scored:
// a site we have not looked at yet is not a site we are neglecting.
type SiteRow = {
  client_id: string;
  site_checks: {
    status: string;
    ssl_expiry: string | null;
    domain_expiry: string | null;
    checked_at: string;
  }[];
};

function worstSiteState(
  sites: SiteRow[],
  now: number
): HealthInput["siteState"] {
  let worst: HealthInput["siteState"] = null;
  for (const site of sites) {
    const risk = assessSite(site.site_checks?.[0] ?? null, now);
    if (risk.level === "down") return "down";
    if (risk.level === "expired" || risk.level === "at-risk") worst = "at-risk";
    else if (risk.level === "healthy" && worst === null) worst = "healthy";
  }
  return worst;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// The clock, read ONCE per request and outside the component body so the render
// stays pure (the repo's convention, matching dateWindow in the email page).
// Every card judges overdue and every score judges staleness against the same
// instant, and nothing reads the clock during a client render, where it would
// answer differently on each side of hydration.
function clockNow(): { nowMs: number; today: string } {
  const now = new Date();
  return { nowMs: now.getTime(), today: now.toISOString().slice(0, 10) };
}

function emptyCard(): ClientCardData {
  return {
    counts: { requests: 0, tasks: 0, printOrders: 0, social: 0, blog: 0 },
    health: { score: null, parts: [] },
    requests: [],
    tasks: [],
    printOrders: [],
    social: [],
    blog: [],
  };
}

// One pass over all five result sets into one map keyed by client id.
//
// Rows with a null client_id are skipped rather than bucketed: inbound requests
// and print orders may name a client we do not manage. Until the orphan slice
// lands that is EVERY request and print order, so both of those counters read
// zero for every client by design, not by fault.
//
// tasks/social/blog counts are the array lengths, so the number on the face and
// the rows in the expansion cannot disagree.
function buildCards(
  requests: RequestRow[],
  printOrders: PrintOrderRow[],
  tasks: TaskRow[],
  social: SocialRow[],
  blog: BlogRow[],
  today: string
): Record<string, ClientCardData> {
  const cards: Record<string, ClientCardData> = {};
  const at = (clientId: string) => (cards[clientId] ??= emptyCard());

  for (const { client_id, ...request } of requests) {
    if (!client_id) continue;
    at(client_id).requests.push(request);
  }
  for (const row of printOrders) {
    if (!row.client_id) continue;
    // The order's lines collapse to one readable line here rather than on the
    // card: the expansion is a glance at what is waiting, and the full job is
    // one click away on the client's Print tab.
    const lines = [...(row.print_order_items ?? [])].sort(
      (a, b) => a.position - b.position
    );
    const first = lines[0];
    at(row.client_id).printOrders.push({
      id: row.id,
      summary: first?.name ?? "Empty order",
      quantity: first?.quantity ?? 0,
      extraLines: Math.max(0, lines.length - 1),
      ordered_at: row.ordered_at ?? row.created_at,
    });
  }
  for (const { client_id, ...task } of tasks) {
    if (!client_id) continue;
    // due_date is a DATE column, so it arrives as 'YYYY-MM-DD' and compares
    // correctly as a string against today in the same format. No Date parsing,
    // so no timezone can shift the answer by a day.
    at(client_id).tasks.push({
      ...task,
      overdue: task.due_date !== null && task.due_date < today,
    });
  }
  for (const { client_id, ...post } of social) {
    if (!client_id) continue;
    at(client_id).social.push(post);
  }
  for (const { client_id, ...post } of blog) {
    if (!client_id) continue;
    at(client_id).blog.push(post);
  }

  for (const card of Object.values(cards)) {
    card.counts.requests = card.requests.length;
    card.counts.printOrders = card.printOrders.length;
    card.counts.tasks = card.tasks.length;
    card.counts.social = card.social.length;
    card.counts.blog = card.blog.length;
  }

  return cards;
}

export default async function HomePage() {
  const supabase = await createClient();
  const [
    clientsRes,
    requestsRes,
    printOrdersRes,
    tasksRes,
    socialRes,
    blogRes,
    sitesRes,
  ] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, slug, status, services, logo_url")
      .order("name"),
    // Both carry the detail the expanded card shows. They were count-only while
    // every inbound row was unassigned; now that assignment works, a counter
    // with nothing behind it expands to an empty panel.
    supabase
      .from("client_requests")
      .select("id, client_id, submitter, message, created_at")
      .eq("status", "new")
      .order("created_at", { ascending: false }),
    supabase
      .from("print_orders")
      .select(
        "id, client_id, ordered_at, created_at, print_order_items(name, quantity, position)"
      )
      .eq("status", "new")
      .order("created_at", { ascending: false }),
    // Ordered here rather than in the component: soonest due first, soonest
    // scheduled first, newest published first. Nulls last so an undated task
    // does not head the list.
    supabase
      .from("client_tasks")
      .select("id, client_id, title, due_date")
      .eq("status", "open")
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("social_posts")
      .select("id, client_id, caption, scheduled_at")
      .eq("status", "scheduled")
      .order("scheduled_at", { ascending: true, nullsFirst: false }),
    // Published only. posts.status is constrained to draft|published (0011);
    // there is no scheduled state for blog, so there is nothing else to count.
    supabase
      .from("posts")
      .select("id, client_id, title, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false }),
    // Latest check per monitored site, for the health score's monitoring input.
    // The old board read this; the card grid dropped it and the score needs it
    // back. No live call to anyone, just the stored check rows.
    supabase
      .from("sites")
      .select(
        "client_id, site_checks(status, ssl_expiry, domain_expiry, checked_at)"
      )
      .eq("monitoring_enabled", true)
      .order("checked_at", {
        referencedTable: "site_checks",
        ascending: false,
      })
      .limit(1, { referencedTable: "site_checks" }),
  ]);

  // services is used below to score health and then left behind: ClientGrid is a
  // client component, and what it needs is the score, not the inputs.
  const clientRows = (clientsRes.data ?? []) as ClientConfigRow[];
  const clients: ClientRow[] = clientRows.map(
    ({ services, ...client }) => client
  );

  const requestRows = (requestsRes.data ?? []) as RequestRow[];
  const printOrderRows = (printOrdersRes.data ?? []) as PrintOrderRow[];

  const { nowMs, today } = clockNow();

  const cards = buildCards(
    requestRows,
    printOrderRows,
    (tasksRes.data ?? []) as TaskRow[],
    (socialRes.data ?? []) as SocialRow[],
    (blogRes.data ?? []) as BlogRow[],
    today
  );

  // --- health score ------------------------------------------------------
  // Computed here, not in the component: it needs the clock, and reading the
  // clock during a client render answers differently on each side of hydration.
  // Everything below is derived from rows already fetched, apart from the sites.
  const sitesByClient = new Map<string, SiteRow[]>();
  for (const site of (sitesRes.data ?? []) as unknown as SiteRow[]) {
    const list = sitesByClient.get(site.client_id) ?? [];
    list.push(site);
    sitesByClient.set(site.client_id, list);
  }

  for (const client of clientRows) {
    const card = (cards[client.id] ??= emptyCard());

    // Oldest open request: the requests array is newest-first, so the last is
    // the oldest. null when nothing is open, which scores as fine.
    const oldest = card.requests.at(-1);
    const oldestOpenRequestDays = oldest
      ? (nowMs - Date.parse(oldest.created_at)) / DAY_MS
      : null;

    // Runway is how far the SCHEDULED queue reaches, so it is the latest
    // scheduled post, not the next one. The array is soonest-first.
    const furthest = card.social.at(-1)?.scheduled_at ?? null;
    const socialRunwayDays = furthest
      ? Math.max(0, (Date.parse(furthest) - nowMs) / DAY_MS)
      : null;

    // Blog is newest-first, so the first entry is the most recent post.
    const latestPost = card.blog[0]?.published_at ?? null;
    const daysSinceLastPost = latestPost
      ? Math.max(0, (nowMs - Date.parse(latestPost)) / DAY_MS)
      : null;

    card.health = healthScore({
      services: client.services ?? [],
      oldestOpenRequestDays,
      socialRunwayDays,
      daysSinceLastPost,
      siteState: worstSiteState(sitesByClient.get(client.id) ?? [], nowMs),
    });
  }

  // The rows the grid cannot show, because they belong to no client.
  const unassigned: UnassignedCounts = {
    requests: requestRows.filter((row) => !row.client_id).length,
    printOrders: printOrderRows.filter((row) => !row.client_id).length,
  };

  return (
    <ClientGrid clients={clients} cards={cards} unassigned={unassigned} />
  );
}
