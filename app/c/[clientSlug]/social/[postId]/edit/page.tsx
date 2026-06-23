import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { socialMediaPublicUrl } from "@/lib/social/media-paths";
import { SocialComposer } from "@/components/social/social-composer";
import type { UploaderItem } from "@/components/social/social-media-uploader";

type MediaRow = {
  position: number;
  storage_path: string;
  media_type: "image" | "video";
  width: number | null;
  height: number | null;
};

export default async function EditSocialPostPage({
  params,
}: {
  params: Promise<{ clientSlug: string; postId: string }>;
}) {
  const { clientSlug, postId } = await params;
  const { client } = await requireClient(clientSlug);

  const supabase = await createClient();
  const { data: post } = await supabase
    .from("social_posts")
    .select(
      "id, client_id, caption, scheduled_at, social_post_media(position, storage_path, media_type, width, height)"
    )
    .eq("id", postId)
    .maybeSingle();
  // RLS already limits to the operator's posts; also ensure it belongs to the
  // client in the URL, not another of the operator's clients.
  if (!post || post.client_id !== client.id) notFound();

  const { data: accounts } = await supabase
    .from("meta_accounts")
    .select("id, platform, display_name")
    .eq("client_id", client.id)
    .order("created_at", { ascending: true });

  const media: UploaderItem[] = ((post.social_post_media ?? []) as MediaRow[])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((m) => ({
      storage_path: m.storage_path,
      media_type: m.media_type,
      width: m.width,
      height: m.height,
      url: socialMediaPublicUrl(m.storage_path),
    }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Edit post</h1>
      <SocialComposer
        clientId={client.id}
        clientSlug={clientSlug}
        mode="edit"
        postId={post.id}
        post={{ caption: post.caption, scheduled_at: post.scheduled_at }}
        initialMedia={media}
        accounts={accounts ?? []}
      />
    </div>
  );
}
