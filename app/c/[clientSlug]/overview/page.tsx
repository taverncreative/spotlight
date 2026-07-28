import { Suspense } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { MonitoringChip } from "@/components/monitoring-chip";
import { Panel, PanelEmpty, Thumb } from "@/components/overview/panel";
import {
  AnalyticsPanel,
  GooglePanelSkeleton,
  SeoPanel,
} from "@/components/overview/google-panels";
import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { assessSite } from "@/lib/sites/monitoring";
import { hostnameFromUrl } from "@/lib/sites/schemas";
import { coverImageUrl } from "@/lib/social/media-paths";
import { healthScore, SERVICE_LABELS } from "@/lib/clients/health";

// The client Overview, rebuilt as a pinboard.
//
// It used to be a linear scroll: a status header, stat cards, the full site
// management surface, then recent posts, then API keys. Finding anything meant
// reading everything, and the page was doing two jobs. It is now a grid of
// panels, each a snippet of one module with a way through to it.
//
// Every panel is READ-ONLY. Site management moved back to /c/[clientSlug]/sites
// (which had been a redirect here) and the Content API keys went to Settings, so
// nothing on this page acts: the heading link is how you act.
//
// Blog and Social carry images rather than lists of titles, because that is what
// breaks the page up and makes it scannable. They also SAY when they are empty,
// where Tasks, Requests, Retainer and Site health simply hide: "no posts yet" on
// a client you blog for is itself a signal, and those two are the board's visual
// anchors, so hiding them would collapse it to almost nothing.
//
// SEO and Analytics stream, because they are the only panels that call Google.
// See components/overview/google-panels.tsx.

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_THUMBS = 6;

type SiteRow = {
  id: string;
  url: string;
  label: string | null;
  site_checks: {
    status: string;
    ssl_expiry: string | null;
    domain_expiry: string | null;
    checked_at: string;
  }[];
};

type TimeRow = {
  kind: string;
  started_at: string;
  ended_at: string | null;
  adjust_seconds: number | null;
};

// The clock, read once and outside the component body so the render stays pure
// (the repo's convention, matching dateWindow in the email page).
function clockNow(): { nowMs: number; today: string; monthStart: string } {
  const now = new Date();
  return {
    nowMs: now.getTime(),
    today: now.toISOString().slice(0, 10),
    monthStart: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    ).toISOString(),
  };
}

function shortDate(iso: string | null): string {
  if (!iso) return "No date";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

// Score to colour, continuously, matching the home card's bar: two segments
// through the palette's warm ramp, no bands.
function healthColour(score: number): string {
  if (score >= 0.5) {
    const mix = Math.round((score - 0.5) * 200);
    return `color-mix(in oklch, var(--color-status-ok) ${mix}%, var(--color-status-warn))`;
  }
  const mix = Math.round(score * 200);
  return `color-mix(in oklch, var(--color-status-warn) ${mix}%, var(--color-status-danger))`;
}

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const { client } = await requireClient(clientSlug);
  const { nowMs, today, monthStart } = clockNow();

  const supabase = await createClient();
  const [
    clientRes,
    sitesRes,
    postsRes,
    socialRes,
    tasksRes,
    requestsRes,
    ordersRes,
    timeRes,
  ] = await Promise.all([
    supabase
      .from("clients")
      .select("services, retainer_minutes")
      .eq("id", client.id)
      .maybeSingle(),
    supabase
      .from("sites")
      .select(
        "id, url, label, site_checks(status, ssl_expiry, domain_expiry, checked_at)"
      )
      .eq("client_id", client.id)
      .eq("monitoring_enabled", true)
      .order("created_at", { ascending: true })
      .order("checked_at", { referencedTable: "site_checks", ascending: false })
      .limit(1, { referencedTable: "site_checks" }),
    supabase
      .from("posts")
      .select("id, title, status, featured_image, published_at, updated_at")
      .eq("client_id", client.id)
      .order("updated_at", { ascending: false })
      .limit(MAX_THUMBS),
    supabase
      .from("social_posts")
      .select(
        "id, caption, status, scheduled_at, social_post_media(position, storage_path, media_type, poster_path)"
      )
      .eq("client_id", client.id)
      .eq("status", "scheduled")
      .order("scheduled_at", { ascending: true, nullsFirst: false })
      .limit(MAX_THUMBS),
    supabase
      .from("client_tasks")
      .select("id, title, due_date")
      .eq("client_id", client.id)
      .eq("status", "open")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(4),
    supabase
      .from("client_requests")
      .select("id, submitter, message, created_at")
      .eq("client_id", client.id)
      .in("status", ["new", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("print_orders")
      .select("id")
      .eq("client_id", client.id)
      .eq("status", "new"),
    supabase
      .from("time_entries")
      .select("kind, started_at, ended_at, adjust_seconds")
      .eq("client_id", client.id)
      .gte("started_at", monthStart),
  ]);

  const services = (clientRes.data?.services as string[] | null) ?? [];
  const retainerMinutes =
    (clientRes.data?.retainer_minutes as number | null) ?? null;
  const sites = (sitesRes.data ?? []) as unknown as SiteRow[];
  const posts = (postsRes.data ?? []) as {
    id: string;
    title: string;
    status: string;
    featured_image: string | null;
    published_at: string | null;
    updated_at: string;
  }[];
  const social = (socialRes.data ?? []) as unknown as {
    id: string;
    caption: string | null;
    scheduled_at: string | null;
    social_post_media: { position: number; storage_path: string }[];
  }[];
  const tasks = (tasksRes.data ?? []) as {
    id: string;
    title: string;
    due_date: string | null;
  }[];
  const requests = (requestsRes.data ?? []) as {
    id: string;
    submitter: string | null;
    message: string;
    created_at: string;
  }[];
  const newOrders = (ordersRes.data ?? []).length;

  // --- health, the same score the home card shows -------------------------
  const risks = sites.map((site) =>
    assessSite(site.site_checks?.[0] ?? null, nowMs)
  );
  const siteState = risks.some((risk) => risk.level === "down")
    ? "down"
    : risks.some((risk) => risk.level === "expired" || risk.level === "at-risk")
      ? "at-risk"
      : risks.some((risk) => risk.level === "healthy")
        ? "healthy"
        : null;

  const oldestRequest = requests.at(-1);
  const furthestSocial = social.at(-1)?.scheduled_at ?? null;
  const latestPost =
    posts.find((post) => post.status === "published")?.published_at ?? null;

  const health = healthScore({
    services,
    oldestOpenRequestDays: oldestRequest
      ? (nowMs - Date.parse(oldestRequest.created_at)) / DAY_MS
      : null,
    socialRunwayDays: furthestSocial
      ? Math.max(0, (Date.parse(furthestSocial) - nowMs) / DAY_MS)
      : null,
    daysSinceLastPost: latestPost
      ? Math.max(0, (nowMs - Date.parse(latestPost)) / DAY_MS)
      : null,
    siteState,
  });

  // --- retainer ------------------------------------------------------------
  // A RUNNING timer contributes nothing here, unlike the /time board which ticks
  // it live. This panel is a snapshot, not a stopwatch.
  const usedSeconds = ((timeRes.data ?? []) as TimeRow[]).reduce(
    (sum, entry) => {
      if (entry.kind === "manual") return sum + (entry.adjust_seconds ?? 0);
      if (!entry.ended_at) return sum;
      return (
        sum +
        Math.round(
          (Date.parse(entry.ended_at) - Date.parse(entry.started_at)) / 1000
        )
      );
    },
    0
  );

  const overdueTasks = tasks.filter(
    (task) => task.due_date !== null && task.due_date < today
  ).length;
  const healthPercent =
    health.score === null ? null : Math.round(health.score * 100);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{client.name}</h1>
        <p className="text-sm text-muted-foreground">
          Where this client stands, at a glance.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {/* Health. Hidden when no service applies: the score is null, not zero,
            and a bar at zero would be a judgement nobody made. */}
        {healthPercent !== null && health.score !== null ? (
          <Panel
            title="Health"
            href={`/c/${clientSlug}/settings`}
            hint={`${healthPercent}%`}
          >
            <div className="h-1.5 overflow-hidden rounded-pill bg-secondary">
              <div
                className="h-full rounded-pill"
                style={{
                  width: `${healthPercent}%`,
                  backgroundColor: healthColour(health.score),
                }}
              />
            </div>
            <ul className="space-y-0.5">
              {health.parts.map((part) => (
                <li
                  key={part.service}
                  className="flex items-baseline justify-between gap-2 text-xs"
                >
                  <span className="text-muted-foreground">
                    {SERVICE_LABELS[part.service]}
                  </span>
                  <span className="tabular-nums">
                    {Math.round(part.value * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {/* Site health. Hidden when there are no monitored sites. Links to the
            Sites module, which is where adding and editing lives. */}
        {sites.length > 0 ? (
          <Panel
            title="Site health"
            href={`/c/${clientSlug}/sites`}
            hint={`${sites.length} ${sites.length === 1 ? "site" : "sites"}`}
          >
            <ul className="space-y-1.5">
              {sites.map((site, index) => (
                <li
                  key={site.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                    {site.label || hostnameFromUrl(site.url)}
                  </span>
                  <MonitoringChip tone={risks[index].tone}>
                    {risks[index].issue ?? "Healthy"}
                  </MonitoringChip>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {/* Tasks. Hidden when nothing is open. */}
        {tasks.length > 0 ? (
          <Panel
            title="Tasks"
            href={`/c/${clientSlug}/tasks`}
            hint={overdueTasks > 0 ? `${overdueTasks} overdue` : undefined}
          >
            <ul className="space-y-1">
              {tasks.map((task) => {
                const overdue = task.due_date !== null && task.due_date < today;
                return (
                  <li
                    key={task.id}
                    className="flex items-baseline justify-between gap-3 text-xs"
                  >
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                    <span
                      className={cn(
                        "shrink-0 tabular-nums",
                        overdue
                          ? "font-medium text-status-danger"
                          : "text-muted-foreground"
                      )}
                    >
                      {shortDate(task.due_date)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ) : null}

        {/* Requests, with print orders folded in as a line rather than a panel
            of their own, matching the tab they now share. Hidden when both are
            empty. */}
        {requests.length > 0 || newOrders > 0 ? (
          <Panel
            title="Requests"
            href={`/c/${clientSlug}/requests`}
            hint={requests.length > 0 ? `${requests.length} open` : undefined}
          >
            <ul className="space-y-1.5">
              {requests.map((request) => (
                <li key={request.id} className="space-y-0.5">
                  <p className="truncate text-xs">{request.message}</p>
                  <p className="text-[0.7rem] text-muted-foreground">
                    {request.submitter ? `${request.submitter} · ` : ""}
                    {shortDate(request.created_at)}
                  </p>
                </li>
              ))}
            </ul>
            {newOrders > 0 ? (
              <Link
                href={`/c/${clientSlug}/requests?view=print`}
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {newOrders} print {newOrders === 1 ? "order" : "orders"} waiting
              </Link>
            ) : null}
          </Panel>
        ) : null}

        {/* Blog. SAYS when empty rather than hiding: on a client you blog for,
            no posts is the signal. */}
        <Panel
          title="Blog"
          href={`/c/${clientSlug}/blog`}
          wide
          hint={posts.length > 0 ? `${posts.length} recent` : undefined}
        >
          {posts.length === 0 ? (
            <PanelEmpty>No posts yet.</PanelEmpty>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {posts.map((post) => (
                <Thumb
                  key={post.id}
                  src={post.featured_image}
                  label={post.title}
                  caption={post.title}
                />
              ))}
            </div>
          )}
        </Panel>

        {/* Social. Same treatment, and the panel that carries the board for a
            client with a real content queue. */}
        <Panel
          title="Social"
          href={`/c/${clientSlug}/social`}
          wide
          hint={social.length > 0 ? `${social.length} scheduled` : undefined}
        >
          {social.length === 0 ? (
            <PanelEmpty>Nothing scheduled.</PanelEmpty>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {social.map((post) => {
                const cover = [...(post.social_post_media ?? [])].sort(
                  (a, b) => a.position - b.position
                )[0];
                return (
                  <Thumb
                    key={post.id}
                    src={cover ? coverImageUrl(cover) : null}
                    label={post.caption ?? "No caption"}
                    caption={shortDate(post.scheduled_at)}
                  />
                );
              })}
            </div>
          )}
        </Panel>

        {/* Retainer. Hidden when no allocation is set, which is most clients. */}
        {retainerMinutes !== null ? (
          <Panel
            title="Retainer"
            href="/time"
            hint={`${(usedSeconds / 3600).toFixed(1)}h of ${(
              retainerMinutes / 60
            ).toFixed(1)}h`}
          >
            <div className="h-1.5 overflow-hidden rounded-pill bg-secondary">
              <div
                className={cn(
                  "h-full rounded-pill",
                  usedSeconds > retainerMinutes * 60
                    ? "bg-status-danger"
                    : "bg-status-ok"
                )}
                style={{
                  width: `${Math.min(
                    100,
                    retainerMinutes > 0
                      ? (usedSeconds / (retainerMinutes * 60)) * 100
                      : 0
                  )}%`,
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">This month</p>
          </Panel>
        ) : null}

        {/* The two that talk to Google, streamed so the board above never waits
            on an external round trip. */}
        <Suspense
          fallback={
            <GooglePanelSkeleton title="SEO" href={`/c/${clientSlug}/seo`} />
          }
        >
          <SeoPanel clientId={client.id} clientSlug={clientSlug} />
        </Suspense>

        <Suspense
          fallback={
            <GooglePanelSkeleton
              title="Analytics"
              href={`/c/${clientSlug}/analytics`}
            />
          }
        >
          <AnalyticsPanel clientId={client.id} clientSlug={clientSlug} />
        </Suspense>
      </div>
    </div>
  );
}
