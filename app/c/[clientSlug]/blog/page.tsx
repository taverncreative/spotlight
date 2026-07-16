import Link from "next/link";
import { ExternalLink, Pencil, Send, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { publishPost, unpublishPost } from "@/lib/posts/actions";
import { PostDeleteButton } from "@/components/post-delete-button";

type PostRow = {
  id: string;
  title: string;
  status: string;
  published_at: string | null;
  updated_at: string;
  featured_image: string | null;
  meta_description: string | null;
};

// Status tabs, mirroring the social list's link-based pattern. Blog's lifecycle
// is only draft|published, so the set is smaller; "empty" is the message shown
// when the tab filters everything out.
const STATUS_TABS: {
  key: string | null;
  label: string;
  matches: string[];
  empty: string;
}[] = [
  { key: null, label: "All", matches: [], empty: "" },
  {
    key: "draft",
    label: "Drafts",
    matches: ["draft"],
    empty: "No drafts for this client.",
  },
  {
    key: "published",
    label: "Published",
    matches: ["published"],
    empty: "No published posts for this client.",
  },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Blog module: the client's posts as a card grid (newest-updated first) with
// status filter tabs, each card showing its square featured image, status pill,
// meta description and icon actions (publish/unpublish, preview, edit, delete).
// Mirrors the social card grid. RLS scopes everything via requireClient +
// owns_client.
export default async function BlogPage({
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
    .from("posts")
    .select(
      "id, title, status, published_at, updated_at, featured_image, meta_description"
    )
    .eq("client_id", client.id)
    .order("updated_at", { ascending: false });
  const posts = (data ?? []) as PostRow[];

  // The DB already orders by updated_at desc; the tab only filters.
  const visible =
    activeTab.key === null
      ? posts
      : posts.filter((post) => activeTab.matches.includes(post.status));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Blog</h1>
          <p className="text-sm text-muted-foreground">
            Posts for this client.
          </p>
        </div>
        <Button size="sm" render={<Link href={`/c/${clientSlug}/blog/new`} />}>
          New post
        </Button>
      </div>

      <nav className="flex flex-wrap gap-1" aria-label="Filter by status">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab.label}
            href={
              tab.key === null
                ? `/c/${clientSlug}/blog`
                : `/c/${clientSlug}/blog?status=${tab.key}`
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
          No posts yet. Write your first post.
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          {activeTab.empty}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((post) => (
            <li
              key={post.id}
              className="flex flex-col overflow-hidden rounded-card border bg-card"
            >
              {/* overflow-hidden + absolute img: the cover is a flex item, so
                  without these a portrait image's natural height (min-height:
                  auto) stretches the aspect-square box instead of cropping. */}
              <div className="relative aspect-square overflow-hidden bg-muted">
                {post.featured_image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={post.featured_image}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    No image
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                <StatusPill status={post.status} />
                <p className="line-clamp-2 text-sm font-medium">{post.title}</p>
                {post.meta_description ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {post.meta_description}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {post.status === "published" && post.published_at
                    ? `Published ${formatDate(post.published_at)}`
                    : `Updated ${formatDate(post.updated_at)}`}
                </p>
                <div className="mt-auto flex items-center justify-end gap-1 pt-1">
                  {post.status === "published" ? (
                    <form action={unpublishPost}>
                      <input type="hidden" name="id" value={post.id} />
                      <input
                        type="hidden"
                        name="client_slug"
                        value={clientSlug}
                      />
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
                  ) : (
                    <form action={publishPost}>
                      <input type="hidden" name="id" value={post.id} />
                      <input
                        type="hidden"
                        name="client_slug"
                        value={clientSlug}
                      />
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
                    render={
                      <Link href={`/c/${clientSlug}/blog/${post.id}/preview`} />
                    }
                  >
                    <ExternalLink />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit "${post.title}"`}
                    title="Edit"
                    render={
                      <Link href={`/c/${clientSlug}/blog/${post.id}/edit`} />
                    }
                  >
                    <Pencil />
                  </Button>
                  <PostDeleteButton
                    postId={post.id}
                    title={post.title}
                    iconTrigger
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
