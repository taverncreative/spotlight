import "server-only";
import { createClient } from "@/lib/supabase/server";
import { socialMediaPublicUrl } from "@/lib/social/media-paths";
import type {
  RenderInput,
  TemplateStyle,
} from "@/lib/social/render-template-style";
import { cleanStyle, isStale, resolveStyle } from "@/lib/social/image-style";

// Reading stored templates and recipes, and turning them into something the
// renderer can draw. The merge rules themselves live in image-style.ts, which is
// pure and tested; this half is the database access.

export type ImageTemplate = {
  id: string;
  name: string;
  canvasWidth: number;
  canvasHeight: number;
  style: Partial<TemplateStyle>;
  updatedAt: string;
};

export type ImageRecipe = {
  id: string;
  postId: string;
  position: number;
  photoPath: string;
  text: string;
  overrides: Partial<TemplateStyle>;
  renderedPath: string | null;
  renderedAt: string | null;
  template: ImageTemplate;
};

export function toRenderInput(recipe: ImageRecipe): RenderInput {
  return {
    ...resolveStyle(recipe.template.style, recipe.overrides),
    photoUrl: socialMediaPublicUrl(recipe.photoPath),
    text: recipe.text,
  };
}

export function recipeIsStale(recipe: ImageRecipe): boolean {
  return isStale(
    recipe.renderedPath,
    recipe.renderedAt,
    recipe.template.updatedAt
  );
}

type TemplateRow = {
  id: string;
  name: string;
  canvas_width: number;
  canvas_height: number;
  style: unknown;
  updated_at: string;
};

type RecipeRow = {
  id: string;
  post_id: string;
  position: number;
  photo_path: string;
  text: string;
  overrides: unknown;
  rendered_path: string | null;
  rendered_at: string | null;
  social_image_templates: TemplateRow | null;
};

const SELECT =
  "id, post_id, position, photo_path, text, overrides, rendered_path, rendered_at, " +
  "social_image_templates(id, name, canvas_width, canvas_height, style, updated_at)";

function toRecipe(row: RecipeRow): ImageRecipe | null {
  const template = row.social_image_templates;
  // Templates are ON DELETE RESTRICT, so a recipe without one should be
  // impossible. Returning null rather than throwing keeps one impossible row
  // from taking down a whole post's editor.
  if (!template) return null;
  return {
    id: row.id,
    postId: row.post_id,
    position: row.position,
    photoPath: row.photo_path,
    text: row.text,
    overrides: cleanStyle(row.overrides),
    renderedPath: row.rendered_path,
    renderedAt: row.rendered_at,
    template: {
      id: template.id,
      name: template.name,
      canvasWidth: template.canvas_width,
      canvasHeight: template.canvas_height,
      style: cleanStyle(template.style),
      updatedAt: template.updated_at,
    },
  };
}

// RLS scopes both tables to the operator, so neither of these needs a client id.
export async function recipesForPost(postId: string): Promise<ImageRecipe[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("social_post_images")
    .select(SELECT)
    .eq("post_id", postId)
    .order("position");
  return ((data ?? []) as unknown as RecipeRow[])
    .map(toRecipe)
    .filter((recipe): recipe is ImageRecipe => recipe !== null);
}

export async function recipeById(id: string): Promise<ImageRecipe | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("social_post_images")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();
  return data ? toRecipe(data as unknown as RecipeRow) : null;
}

export async function templatesForClient(
  clientId: string
): Promise<ImageTemplate[]> {
  const supabase = await createClient();
  // Shared templates (null client_id) alongside the ones pinned to this client.
  const { data } = await supabase
    .from("social_image_templates")
    .select("id, name, canvas_width, canvas_height, style, updated_at")
    .is("archived_at", null)
    .or(`client_id.is.null,client_id.eq.${clientId}`)
    .order("name");
  return ((data ?? []) as TemplateRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    canvasWidth: row.canvas_width,
    canvasHeight: row.canvas_height,
    style: cleanStyle(row.style),
    updatedAt: row.updated_at,
  }));
}
