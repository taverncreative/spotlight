import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireClient } from "@/lib/clients/require-client";
import { Button } from "@/components/ui/button";
import { ImageEditor } from "@/components/social/image-editor";
import {
  recipesForPost,
  templatesForClient,
} from "@/lib/social/image-recipe";

// Making the image for one social post.
//
// Its own page rather than a panel in the composer: the composer is about the
// words and where they go, this is about making a picture, and the two want the
// whole width for different reasons.
export default async function SocialImagePage({
  params,
}: {
  params: Promise<{ clientSlug: string; postId: string }>;
}) {
  const { clientSlug, postId } = await params;
  const { client } = await requireClient(clientSlug);

  const supabase = await createClient();
  const { data: post } = await supabase
    .from("social_posts")
    .select("id, client_id, status, social_post_media(position, storage_path)")
    .eq("id", postId)
    .maybeSingle();
  // RLS already limits to the operator's posts; this also stops one client's URL
  // reaching another client's post.
  if (!post || post.client_id !== client.id) notFound();

  const [templates, recipes] = await Promise.all([
    templatesForClient(client.id),
    recipesForPost(postId),
  ]);

  const photos = ((post.social_post_media ?? []) as {
    position: number;
    storage_path: string;
  }[])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((media) => ({ storagePath: media.storage_path }));

  const existing = recipes[0] ?? null;

  if (templates.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Post image</h1>
        <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">
          No templates yet. One is seeded per operator, so if this is empty
          something is wrong with the seed rather than with this post.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Post image</h1>
          <p className="text-sm text-muted-foreground">
            Put the headline on the photo. Saving stores the recipe, not the
            picture, so editing the template later still reaches this post.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          render={<Link href={`/c/${clientSlug}/social/${postId}/edit`} />}
        >
          Back to post
        </Button>
      </div>

      {post.status === "published" ? (
        <p className="rounded-card border border-dashed bg-card/50 p-4 text-sm text-muted-foreground">
          This post has already gone out. You can still change the recipe, but
          the image on Instagram and Facebook is the one that was published and
          nothing here can change it.
        </p>
      ) : null}

      <ImageEditor
        clientSlug={clientSlug}
        postId={postId}
        templates={templates.map((template) => ({
          id: template.id,
          name: template.name,
          style: template.style,
        }))}
        photos={photos}
        initial={{
          recipeId: existing?.id ?? null,
          templateId: existing?.template.id ?? null,
          photoPath: existing?.photoPath ?? null,
          text: existing?.text ?? "",
          overrides: existing?.overrides ?? {},
        }}
      />
    </div>
  );
}
