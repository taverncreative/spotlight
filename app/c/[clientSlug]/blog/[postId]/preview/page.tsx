import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/lib/markdown/markdown";

// Operator-only rendered view of a post, using the shared lib/markdown renderer
// so it matches what the client sites publish. Behind requireClient; RLS plus
// the client_id check keep it scoped to the operator's post for this client.
export default async function PreviewPostPage({
  params,
}: {
  params: Promise<{ clientSlug: string; postId: string }>;
}) {
  const { clientSlug, postId } = await params;
  const { client } = await requireClient(clientSlug);

  const supabase = await createClient();
  const { data: post } = await supabase
    .from("posts")
    .select(
      "id, title, body, meta_description, featured_image, status, client_id"
    )
    .eq("id", postId)
    .maybeSingle();
  if (!post || post.client_id !== client.id) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Preview</span>
          <Badge variant={post.status === "published" ? "default" : "outline"}>
            {post.status === "published" ? "Published" : "Draft"}
          </Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          render={<Link href={`/c/${clientSlug}/blog/${post.id}/edit`} />}
        >
          Back to edit
        </Button>
      </div>

      <article className="space-y-4">
        {post.featured_image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.featured_image}
            alt=""
            className="w-full rounded-card border"
          />
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight">{post.title}</h1>
        {post.meta_description ? (
          <p className="text-muted-foreground">{post.meta_description}</p>
        ) : null}
        {post.body ? (
          <Markdown>{post.body}</Markdown>
        ) : (
          <p className="text-sm text-muted-foreground">
            This post has no body yet.
          </p>
        )}
      </article>
    </div>
  );
}
