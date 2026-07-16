import Link from "next/link";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { socialMediaPublicUrl } from "@/lib/social/media-paths";
import { StatusPill } from "@/components/ui/status-pill";
import { SocialCancelButton } from "@/components/social/social-cancel-button";
import { SocialDeleteButton } from "@/components/social/social-delete-button";

type MediaRow = { position: number; storage_path: string };
type TargetRow = {
  meta_account_id: string;
  meta_accounts: { platform: string } | null;
};
type PostRow = {
  id: string;
  caption: string;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
  last_error: string | null;
  social_post_media: MediaRow[];
  social_post_targets: TargetRow[];
};

// Status tabs. "Failed" folds in partial (some targets failed) so nothing
// broken hides behind a tab; "publishing" only ever appears under All.
const STATUS_TABS: { key: string | null; label: string; matches: string[] }[] =
  [
    { key: null, label: "All", matches: [] },
    { key: "draft", label: "Drafts", matches: ["draft"] },
    { key: "scheduled", label: "Scheduled", matches: ["scheduled"] },
    { key: "published", label: "Published", matches: ["published"] },
    { key: "failed", label: "Failed", matches: ["failed", "partial"] },
  ];

function formatLondon(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Social module: the client's posts as a card grid (newest first), each with its
// cover photo, carousel count, status pill, target platforms and schedule time.
// RLS scopes everything via requireClient + owns_client.
export default async function SocialPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { clientSlug } = await params;
  const { status: statusParam } = await searchParams;
  const { client } = await requireClient(clientSlug);

  const activeTab =
    STATUS_TABS.find((tab) => tab.key !== null && tab.key === statusParam) ??
    STATUS_TABS[0];

  const supabase = await createClient();
  const { data } = await supabase
    .from("social_posts")
    .select(
      "id, caption, status, scheduled_at, published_at, created_at, last_error, social_post_media(position, storage_path), social_post_targets(meta_account_id, meta_accounts(platform))"
    )
    .eq("client_id", client.id)
    .order("created_at", { ascending: false });
  const posts = (data ?? []) as unknown as PostRow[];

  // Upcoming scheduled posts first (soonest scheduled_at on top), then drafts and
  // published by recency (created_at descending).
  const ordered = posts.slice().sort((a, b) => {
    const aScheduled = a.status === "scheduled" ? a.scheduled_at : null;
    const bScheduled = b.status === "scheduled" ? b.scheduled_at : null;
    if (aScheduled && bScheduled) return aScheduled.localeCompare(bScheduled);
    if (aScheduled) return -1;
    if (bScheduled) return 1;
    return b.created_at.localeCompare(a.created_at);
  });

  const visible =
    activeTab.key === null
      ? ordered
      : ordered.filter((post) => activeTab.matches.includes(post.status));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Social</h1>
          <p className="text-sm text-muted-foreground">
            Posts for this client.
          </p>
        </div>
        <Button
          size="sm"
          render={<Link href={`/c/${clientSlug}/social/new`} />}
        >
          New post
        </Button>
      </div>

      <nav className="flex flex-wrap gap-1" aria-label="Filter by status">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab.label}
            href={
              tab.key === null
                ? `/c/${clientSlug}/social`
                : `/c/${clientSlug}/social?status=${tab.key}`
            }
            aria-current={tab.key === activeTab.key ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1 text-sm transition-colors",
              tab.key === activeTab.key
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {posts.length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          No posts yet. Create your first post.
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          No {activeTab.label.toLowerCase()} for this client.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((post) => {
            const media = (post.social_post_media ?? [])
              .slice()
              .sort((a, b) => a.position - b.position);
            const cover = media[0];
            const when =
              post.status === "published" && post.published_at
                ? `Published ${formatLondon(post.published_at)}`
                : post.status === "scheduled" && post.scheduled_at
                  ? `Scheduled ${formatLondon(post.scheduled_at)}`
                  : `Created ${formatLondon(post.created_at)}`;
            const platforms = Array.from(
              new Set(
                (post.social_post_targets ?? [])
                  .map((t) => t.meta_accounts?.platform)
                  .filter((p): p is string => !!p)
              )
            );
            return (
              <li
                key={post.id}
                className="flex flex-col overflow-hidden rounded-card border bg-card"
              >
                <div className="relative aspect-square bg-muted">
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={socialMediaPublicUrl(cover.storage_path)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      No photo
                    </div>
                  )}
                  {media.length > 1 ? (
                    <span className="absolute right-2 top-2 rounded-md bg-background/80 px-1.5 py-0.5 text-xs font-medium tabular-nums">
                      ▦ {media.length}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <StatusPill status={post.status} />
                    <span className="truncate text-xs text-muted-foreground capitalize">
                      {platforms.length ? platforms.join(", ") : "No targets"}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-sm">
                    {post.caption || (
                      <span className="text-muted-foreground">No caption</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{when}</p>
                  {(post.status === "failed" || post.status === "partial") &&
                  post.last_error ? (
                    <p className="line-clamp-3 text-xs text-destructive">
                      {post.last_error}
                    </p>
                  ) : null}
                  <div className="mt-auto flex items-center justify-end gap-1 pt-1">
                    {post.status === "scheduled" ? (
                      <SocialCancelButton postId={post.id} iconTrigger />
                    ) : null}
                    {post.status === "draft" || post.status === "scheduled" ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Edit post"
                        title="Edit"
                        render={
                          <Link
                            href={`/c/${clientSlug}/social/${post.id}/edit`}
                          />
                        }
                      >
                        <Pencil />
                      </Button>
                    ) : null}
                    <SocialDeleteButton postId={post.id} iconTrigger />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
