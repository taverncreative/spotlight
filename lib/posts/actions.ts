"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  postFormSchema,
  fieldErrorsFromZod,
  type PostFormState,
} from "@/lib/posts/schemas";

// All actions operate under RLS: the posts policy allows writes only when
// owns_client(client_id) is true.

const SLUG_TAKEN = {
  ok: false,
  fieldErrors: { slug: ["That slug is already in use for this client."] },
} satisfies PostFormState;

function parseForm(formData: FormData) {
  return postFormSchema.safeParse({
    title: String(formData.get("title") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    body: String(formData.get("body") ?? ""),
    meta_description: String(formData.get("meta_description") ?? ""),
  });
}

export async function createPost(
  _previous: PostFormState,
  formData: FormData
): Promise<PostFormState> {
  const clientId = String(formData.get("client_id") ?? "");
  const clientSlug = String(formData.get("client_slug") ?? "");
  if (!clientId || !clientSlug) return { ok: false, error: "Missing client." };

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const publish = formData.get("intent") === "publish";
  const supabase = await createClient();
  const { error } = await supabase.from("posts").insert({
    client_id: clientId,
    title: parsed.data.title,
    slug: parsed.data.slug,
    body: parsed.data.body || null,
    meta_description: parsed.data.meta_description || null,
    status: publish ? "published" : "draft",
    published_at: publish ? new Date().toISOString() : null,
  });
  if (error) {
    if (error.code === "23505") return SLUG_TAKEN;
    return { ok: false, error: "Could not save the post." };
  }

  redirect(`/c/${clientSlug}/blog`);
}

export async function updatePost(
  _previous: PostFormState,
  formData: FormData
): Promise<PostFormState> {
  const id = String(formData.get("id") ?? "");
  const clientSlug = String(formData.get("client_slug") ?? "");
  if (!id || !clientSlug) return { ok: false, error: "Missing post." };

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  const publish = formData.get("intent") === "publish";
  const supabase = await createClient();

  const update: Record<string, string | null> = {
    title: parsed.data.title,
    slug: parsed.data.slug,
    body: parsed.data.body || null,
    meta_description: parsed.data.meta_description || null,
    status: publish ? "published" : "draft",
  };
  if (publish) {
    // Stamp published_at on first publish only; preserve it afterwards.
    const { data: current } = await supabase
      .from("posts")
      .select("published_at")
      .eq("id", id)
      .maybeSingle();
    update.published_at = current?.published_at ?? new Date().toISOString();
  }

  const { error } = await supabase.from("posts").update(update).eq("id", id);
  if (error) {
    if (error.code === "23505") return SLUG_TAKEN;
    return { ok: false, error: "Could not save the post." };
  }

  redirect(`/c/${clientSlug}/blog`);
}

export async function deletePost(
  _previous: PostFormState,
  formData: FormData
): Promise<PostFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing post id." };
  const supabase = await createClient();
  const { error } = await supabase.from("posts").delete().eq("id", id);
  if (error) return { ok: false, error: "Could not delete the post." };
  return { ok: true };
}

// List quick-actions (plain form actions): toggle status and revalidate the list.
export async function publishPost(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const clientSlug = String(formData.get("client_slug") ?? "");
  if (!id) return;
  const supabase = await createClient();
  const { data: current } = await supabase
    .from("posts")
    .select("published_at")
    .eq("id", id)
    .maybeSingle();
  await supabase
    .from("posts")
    .update({
      status: "published",
      published_at: current?.published_at ?? new Date().toISOString(),
    })
    .eq("id", id);
  if (clientSlug) revalidatePath(`/c/${clientSlug}/blog`);
}

export async function unpublishPost(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const clientSlug = String(formData.get("client_slug") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("posts").update({ status: "draft" }).eq("id", id);
  if (clientSlug) revalidatePath(`/c/${clientSlug}/blog`);
}
