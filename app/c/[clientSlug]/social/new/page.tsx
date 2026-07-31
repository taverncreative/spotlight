import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { SocialComposer } from "@/components/social/social-composer";
import { lastScheduledTime } from "@/lib/social/default-schedule";

export default async function NewSocialPostPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const { client } = await requireClient(clientSlug);

  const supabase = await createClient();
  const [{ data: accounts }, defaultTime] = await Promise.all([
    supabase
      .from("meta_accounts")
      .select("id, platform, display_name")
      .eq("client_id", client.id)
      .order("created_at", { ascending: true }),
    lastScheduledTime(client.id),
  ]);

  // Generate the post id server-side so it is stable across SSR/hydration and
  // media can upload to its storage path before the post row is saved.
  const postId = randomUUID();

  // EVERY connected account ticked. A post that goes to one platform and not the
  // other is the exception, so the default is both and unticking is the
  // deliberate act. Nothing is published by this: the targets only decide where
  // Schedule or Publish would send it.
  const allTargetIds = (accounts ?? []).map((account) => account.id);

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
        selectedTargetIds={allTargetIds}
        defaultTime={defaultTime}
      />
    </div>
  );
}
