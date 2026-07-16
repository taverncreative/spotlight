import Link from "next/link";
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Blog module: the client's posts as a card grid (newest-updated first), each
// with its featured image, status pill, meta description and per-card
// publish/unpublish, preview, edit and delete. Mirrors the social card grid, at
// two columns so the four controls fit. RLS scopes everything via requireClient
// + owns_client.
export default async function BlogPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const { client } = await requireClient(clientSlug);

  const supabase = await createClient();
  const { data } = await supabase
    .from("posts")
    .select(
      "id, title, status, published_at, updated_at, featured_image, meta_description"
    )
    .eq("client_id", client.id)
    .order("updated_at", { ascending: false });
  const posts = (data ?? []) as PostRow[];

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

      {posts.length === 0 ? (
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          No posts yet. Write your first post.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
          {posts.map((post) => (
            <li
              key={post.id}
              className="flex flex-col overflow-hidden rounded-card border bg-card"
            >
              <div className="relative aspect-video bg-muted">
                {post.featured_image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={post.featured_image}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    No image
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
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
                      <Button type="submit" variant="ghost" size="sm">
                        Unpublish
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
                      <Button type="submit" variant="ghost" size="sm">
                        Publish
                      </Button>
                    </form>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    render={
                      <Link href={`/c/${clientSlug}/blog/${post.id}/preview`} />
                    }
                  >
                    Preview
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    render={
                      <Link href={`/c/${clientSlug}/blog/${post.id}/edit`} />
                    }
                  >
                    Edit
                  </Button>
                  <PostDeleteButton postId={post.id} title={post.title} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
