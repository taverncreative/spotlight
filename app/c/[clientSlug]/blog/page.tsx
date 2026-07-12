import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Blog module: the client's posts, newest-updated first, with status pills and
// per-row publish/unpublish, edit and delete. RLS scopes everything via
// requireClient + owns_client.
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
    .select("id, title, status, published_at, updated_at")
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
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          No posts yet. Write your first post.
        </p>
      ) : (
        <ul className="grid gap-2">
          {posts.map((post) => (
            <li
              key={post.id}
              className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{post.title}</p>
                  <Badge
                    variant={
                      post.status === "published" ? "default" : "outline"
                    }
                  >
                    {post.status === "published" ? "Published" : "Draft"}
                  </Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {post.status === "published" && post.published_at
                    ? `Published ${formatDate(post.published_at)}`
                    : `Updated ${formatDate(post.updated_at)}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
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
                    <Link href={`/c/${clientSlug}/blog/${post.id}/edit`} />
                  }
                >
                  Edit
                </Button>
                <PostDeleteButton postId={post.id} title={post.title} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
