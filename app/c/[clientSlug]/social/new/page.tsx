import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { SocialComposer } from "@/components/social/social-composer";

export default async function NewSocialPostPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const { client } = await requireClient(clientSlug);

  const supabase = await createClient();
  const { data: accounts } = await supabase
    .from("meta_accounts")
    .select("id, platform, display_name")
    .eq("client_id", client.id)
    .order("created_at", { ascending: true });

  // Generate the post id server-side so it is stable across SSR/hydration and
  // media can upload to its storage path before the post row is saved.
  const postId = randomUUID();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">New post</h1>
      <SocialComposer
        clientId={client.id}
        clientSlug={clientSlug}
        mode="new"
        postId={postId}
        post={null}
        initialMedia={[]}
        accounts={accounts ?? []}
      />
    </div>
  );
}
