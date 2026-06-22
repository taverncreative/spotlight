import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { PostForm } from "@/components/post-form";

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ clientSlug: string; postId: string }>;
}) {
  const { clientSlug, postId } = await params;
  const { client } = await requireClient(clientSlug);

  const supabase = await createClient();
  const { data: post } = await supabase
    .from("posts")
    .select("id, title, slug, body, meta_description, featured_image, client_id")
    .eq("id", postId)
    .maybeSingle();
  // RLS already limits to the operator's posts; also ensure it belongs to the
  // client in the URL, not another of the operator's clients.
  if (!post || post.client_id !== client.id) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Edit post</h1>
      <PostForm
        clientId={client.id}
        clientSlug={clientSlug}
        post={{
          id: post.id,
          title: post.title,
          slug: post.slug,
          body: post.body,
          meta_description: post.meta_description,
          featured_image: post.featured_image,
        }}
      />
    </div>
  );
}
