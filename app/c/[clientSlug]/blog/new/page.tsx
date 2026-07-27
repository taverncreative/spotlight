import { requireClient } from "@/lib/clients/require-client";
import { PostForm } from "@/components/post-form";
import { seoContextForClient } from "@/lib/posts/seo-context";

export default async function NewPostPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const { client } = await requireClient(clientSlug);
  const seoContext = await seoContextForClient(client.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">New post</h1>
      <PostForm
        clientId={client.id}
        clientSlug={clientSlug}
        post={null}
        seoContext={seoContext}
      />
    </div>
  );
}
