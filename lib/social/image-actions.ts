"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { cleanStyle, resolveStyle } from "@/lib/social/image-style";
import { socialMediaPublicUrl } from "@/lib/social/media-paths";
import { SOCIAL_MEDIA_BUCKET } from "@/lib/social/schemas";
import { CANVAS } from "@/lib/social/render-template-style";
import { renderPath, renderToPng } from "@/lib/social/render-to-storage";

// Saving an image recipe. RLS scopes every write through owns_social_post, so
// nothing here re-checks ownership: the policy is the check, and a second
// hand-rolled one is a second thing that can drift from it.
//
// STORES THE OVERRIDES, NOT THE RESOLVED STYLE. The editor works with a fully
// resolved style because it has to draw something, but writing that back would
// freeze every value the operator never touched, and the post would stop
// following its template. So the diff against the template is what is stored --
// which is the difference between a template that means something and one that
// is only a starting point.

export type ImageRecipeState = {
  ok: boolean;
  error?: string;
  id?: string;
} | null;

function diffAgainstTemplate(
  resolved: Record<string, unknown>,
  templateStyle: Record<string, unknown>
): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(resolved)) {
    // Only what actually differs. Object.is so that a deliberate 0 or false is
    // kept when the template says otherwise, rather than being swallowed.
    if (!Object.is(value, templateStyle[key])) overrides[key] = value;
  }
  return overrides;
}

export async function saveImageRecipe(
  _previous: ImageRecipeState,
  formData: FormData
): Promise<ImageRecipeState> {
  const postId = String(formData.get("post_id") ?? "");
  const templateId = String(formData.get("template_id") ?? "");
  const photoPath = String(formData.get("photo_path") ?? "");
  const clientSlug = String(formData.get("client_slug") ?? "");
  const recipeId = String(formData.get("recipe_id") ?? "");
  const text = String(formData.get("text") ?? "");

  if (!postId || !templateId || !photoPath) {
    return { ok: false, error: "Pick a template and a photo first." };
  }
  if (text.length > 500) {
    return { ok: false, error: "That is too long for a headline." };
  }

  const supabase = await createClient();

  // The template's own style, to diff against. Read through RLS, so a template
  // belonging to someone else simply is not found.
  const { data: template } = await supabase
    .from("social_image_templates")
    .select("style")
    .eq("id", templateId)
    .maybeSingle();
  if (!template) return { ok: false, error: "That template no longer exists." };

  let submitted: unknown;
  try {
    submitted = JSON.parse(String(formData.get("style") ?? "{}"));
  } catch {
    // The editor writes this field, so bad json is a bug or a tampered form,
    // not something to explain to the operator in their own words.
    return { ok: false, error: "Could not read the settings." };
  }

  const overrides = diffAgainstTemplate(
    cleanStyle(submitted) as Record<string, unknown>,
    cleanStyle(template.style) as Record<string, unknown>
  );

  const row = {
    post_id: postId,
    template_id: templateId,
    photo_path: photoPath,
    text,
    overrides,
    // Any edit invalidates the cached render. Clearing it is what stops a stale
    // picture being published: rendered_at null reads as "never rendered"
    // everywhere that asks.
    rendered_path: null,
    rendered_at: null,
    last_error: null,
  };

  const query = recipeId
    ? supabase.from("social_post_images").update(row).eq("id", recipeId).select("id")
    : supabase
        .from("social_post_images")
        .insert({ ...row, position: 0 })
        .select("id");

  const { data, error } = await query.maybeSingle();
  if (error) {
    // 23505 is the (post_id, position) unique index: one image per slot.
    if (error.code === "23505") {
      return { ok: false, error: "This post already has an image in that slot." };
    }
    return { ok: false, error: "Could not save the image." };
  }

  if (clientSlug) revalidatePath(`/c/${clientSlug}/social/${postId}/image`);
  return { ok: true, id: data?.id as string | undefined };
}

// --- rendering, and attaching the result to the post ----------------------

// Rasterise a saved recipe, put the PNG in storage, and make it the post's media
// at that slot so it publishes like any other image.
//
// THE RENDER REPLACES THE MEDIA ROW AT ITS POSITION rather than being added
// alongside. A post whose media list held both the source photo and the
// composed image would publish both, and the naked photo is exactly what nobody
// wants going out. The source is not lost: it stays in the bucket and the recipe
// still points at it, which is what allows a re-render.
//
// KNOWN LIMIT, stated rather than discovered later: this handles one image per
// post. A carousel of several composed images needs a recipe per position and a
// picker that understands slots, and neither exists yet.
export async function renderImageRecipe(
  _previous: ImageRecipeState,
  formData: FormData
): Promise<ImageRecipeState> {
  const recipeId = String(formData.get("recipe_id") ?? "");
  const clientSlug = String(formData.get("client_slug") ?? "");
  if (!recipeId) return { ok: false, error: "Save the image first." };

  const supabase = await createClient();

  // RLS scopes this to the operator's own recipes, so a wrong id is simply not
  // found rather than needing its own ownership check.
  // The embedded rows come back typed as an error union without a generated
  // schema, so the shape is asserted once here rather than at every use.
  type RecipeRow = {
    id: string;
    post_id: string;
    position: number;
    photo_path: string;
    text: string;
    overrides: unknown;
    rendered_path: string | null;
    social_posts: { client_id: string } | null;
    social_image_templates: { style: unknown } | null;
  };

  const { data } = await supabase
    .from("social_post_images")
    .select(
      "id, post_id, position, photo_path, text, overrides, rendered_path, " +
        "social_posts(client_id), " +
        "social_image_templates(style)"
    )
    .eq("id", recipeId)
    .maybeSingle();
  const row = data as unknown as RecipeRow | null;
  if (!row) return { ok: false, error: "That image no longer exists." };

  const post = row.social_posts;
  const template = row.social_image_templates;
  if (!post || !template) {
    return { ok: false, error: "That image is missing its post or template." };
  }

  const input = {
    ...resolveStyle(template.style, row.overrides),
    photoUrl: socialMediaPublicUrl(row.photo_path),
    text: row.text ?? "",
  };

  let png: Buffer;
  try {
    png = await renderToPng(input);
  } catch {
    // The failure is recorded against the row so a permanently broken recipe is
    // visible rather than silently never rendering.
    await supabase
      .from("social_post_images")
      .update({ last_error: "Could not render the image." })
      .eq("id", recipeId);
    return { ok: false, error: "Could not render the image." };
  }

  const previous = row.rendered_path;
  const path = renderPath(
    post.client_id,
    row.post_id,
    recipeId,
    Date.now()
  );

  const upload = await supabase.storage
    .from(SOCIAL_MEDIA_BUCKET)
    .upload(path, png, { contentType: "image/png", upsert: false });
  if (upload.error) {
    await supabase
      .from("social_post_images")
      .update({ last_error: "Could not store the rendered image." })
      .eq("id", recipeId);
    return { ok: false, error: "Could not store the rendered image." };
  }

  // Take over the slot. onConflict on (post_id, position) so a re-render
  // replaces rather than colliding with the row it made last time.
  const { error: mediaError } = await supabase.from("social_post_media").upsert(
    {
      post_id: row.post_id,
      position: row.position ?? 0,
      storage_path: path,
      media_type: "image",
      width: CANVAS.width,
      height: CANVAS.height,
    },
    { onConflict: "post_id,position" }
  );
  if (mediaError) {
    // The object is already uploaded, so leave it: an orphan in the bucket is
    // cheaper than a post whose media row points at nothing.
    return { ok: false, error: "Could not attach the image to the post." };
  }

  await supabase
    .from("social_post_images")
    .update({
      rendered_path: path,
      rendered_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", recipeId);

  // Best effort, and last on purpose: the new render is already live, so a
  // failure here leaves a stale object in the bucket rather than breaking the
  // post.
  if (previous && previous !== path) {
    await supabase.storage.from(SOCIAL_MEDIA_BUCKET).remove([previous]);
  }

  if (clientSlug) {
    revalidatePath(`/c/${clientSlug}/social/${row.post_id}/image`);
    revalidatePath(`/c/${clientSlug}/social/${row.post_id}/edit`);
  }
  return { ok: true, id: recipeId };
}
