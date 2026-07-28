"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { cleanStyle } from "@/lib/social/image-style";
import { CANVAS } from "@/lib/social/render-template-style";

// Creating, copying and updating templates.
//
// PICKING A TEMPLATE AND TWEAKING IT NEVER TOUCHES THE TEMPLATE. That is not
// enforced here -- it falls out of how a recipe saves, which stores only the
// diff against the template (image-actions.ts). These three actions are the
// only paths that write to a template at all, and each one is something the
// operator asked for by name.
//
// RLS scopes every statement to the operator's own templates, so none of these
// re-checks ownership: the policy is the check, and a second hand-rolled one is
// a second thing that can drift from it.

export type TemplateActionState = {
  ok: boolean;
  error?: string;
  templateId?: string;
} | null;

function readName(formData: FormData): string {
  return String(formData.get("name") ?? "").trim().slice(0, 80);
}

function readStyle(formData: FormData): Record<string, unknown> | null {
  try {
    return cleanStyle(JSON.parse(String(formData.get("style") ?? "{}"))) as Record<
      string,
      unknown
    >;
  } catch {
    // The editor writes this field, so bad json is a bug or a tampered form
    // rather than something to explain in the operator's own words.
    return null;
  }
}

// Save whatever is on screen as a NEW template. The post keeps using whichever
// template it had until it is switched, because creating a look and adopting it
// are different decisions.
export async function createTemplate(
  _previous: TemplateActionState,
  formData: FormData
): Promise<TemplateActionState> {
  const name = readName(formData);
  const style = readStyle(formData);
  const clientSlug = String(formData.get("client_slug") ?? "");
  const postId = String(formData.get("post_id") ?? "");
  if (!name) return { ok: false, error: "Give the template a name." };
  if (!style) return { ok: false, error: "Could not read the settings." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("social_image_templates")
    .insert({
      name,
      // Available to every client, matching the seeded one. A template pinned to
      // a client is a narrower thing than anyone wants by default, and pinning
      // later is an edit where unpinning later is a surprise.
      client_id: null,
      canvas_width: CANVAS.width,
      canvas_height: CANVAS.height,
      style,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) return { ok: false, error: "Could not save the template." };
  if (clientSlug && postId) {
    revalidatePath(`/c/${clientSlug}/social/${postId}/image`);
  }
  return { ok: true, templateId: data.id as string };
}

// Copy an existing template as a starting point. The copy is independent from
// the moment it exists: editing it never reaches the original, which is the
// whole reason to duplicate rather than edit in place.
export async function duplicateTemplate(
  _previous: TemplateActionState,
  formData: FormData
): Promise<TemplateActionState> {
  const templateId = String(formData.get("template_id") ?? "");
  const clientSlug = String(formData.get("client_slug") ?? "");
  const postId = String(formData.get("post_id") ?? "");
  if (!templateId) return { ok: false, error: "Pick a template to copy." };

  const supabase = await createClient();
  const { data: source } = await supabase
    .from("social_image_templates")
    .select("name, client_id, canvas_width, canvas_height, style")
    .eq("id", templateId)
    .maybeSingle();
  if (!source) return { ok: false, error: "That template no longer exists." };

  const { data, error } = await supabase
    .from("social_image_templates")
    .insert({
      name: `${String(source.name).slice(0, 72)} copy`,
      client_id: source.client_id,
      canvas_width: source.canvas_width,
      canvas_height: source.canvas_height,
      style: source.style,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) return { ok: false, error: "Could not copy the template." };
  if (clientSlug && postId) {
    revalidatePath(`/c/${clientSlug}/social/${postId}/image`);
  }
  return { ok: true, templateId: data.id as string };
}

// Write the current settings back to the template. THE ONLY ACTION THAT CHANGES
// HOW OTHER POSTS LOOK.
//
// It reaches every post using this template that has not overridden the fields
// being changed -- which is the point of templates, and also the reason this is
// a separate, named action rather than something Save does quietly. The editor
// shows how many posts are affected before it is pressed.
//
// It cannot reach a post that is already published. That image is on Instagram
// and Facebook and nothing here changes it.
export async function updateTemplateStyle(
  _previous: TemplateActionState,
  formData: FormData
): Promise<TemplateActionState> {
  const templateId = String(formData.get("template_id") ?? "");
  const style = readStyle(formData);
  const clientSlug = String(formData.get("client_slug") ?? "");
  const postId = String(formData.get("post_id") ?? "");
  if (!templateId) return { ok: false, error: "No template selected." };
  if (!style) return { ok: false, error: "Could not read the settings." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("social_image_templates")
    .update({ style })
    .eq("id", templateId);
  if (error) return { ok: false, error: "Could not update the template." };

  // Every cached render made from this template is now stale. They are not
  // cleared here: staleness is derived by comparing rendered_at against the
  // template's updated_at (image-style.ts), so a single timestamp does the work
  // that a fan-out of writes would otherwise do, and it cannot half-finish.
  if (clientSlug && postId) {
    revalidatePath(`/c/${clientSlug}/social/${postId}/image`);
  }
  return { ok: true, templateId };
}
