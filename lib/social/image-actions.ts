"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { cleanStyle } from "@/lib/social/image-style";

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
