"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  postFormSchema,
  fieldErrorsFromZod,
  type PostFormState,
} from "@/lib/posts/schemas";
import { reapPostImages, inlineImageUrls } from "@/lib/posts/image-paths";
import { triggerDeployHook } from "@/lib/posts/deploy-hook";

// All actions operate under RLS: the posts policy allows writes only when
// owns_client(client_id) is true.
//
// Every path that can change what a client's PUBLIC site serves calls
// triggerDeployHook, so a static site rebuilds itself. The helper owns the rule
// (fire unless draft -> draft) and the skip when a client has no hook, so each
// call site only has to hand it the client and the two statuses. It never
// blocks: it registers with after() and returns immediately, so it is called
// without await and its failures cannot reach the operator.

const SLUG_TAKEN = {
  ok: false,
  fieldErrors: { slug: ["That slug is already in use for this client."] },
} satisfies PostFormState;

function parseForm(formData: FormData) {
  return postFormSchema.safeParse({
    title: String(formData.get("title") ?? ""),
    meta_title: String(formData.get("meta_title") ?? ""),
    excerpt: String(formData.get("excerpt") ?? ""),
    focus_keyword: String(formData.get("focus_keyword") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    body: String(formData.get("body") ?? ""),
    meta_description: String(formData.get("meta_description") ?? ""),
    featured_image: String(formData.get("featured_image") ?? ""),
    featured_image_alt: String(formData.get("featured_image_alt") ?? ""),
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
    // Blank stores null, which is what makes the editor's prefill honest: the
    // meta title falls back to the post title until someone changes it.
    meta_title: parsed.data.meta_title || null,
    slug: parsed.data.slug,
    body: parsed.data.body || null,
    meta_description: parsed.data.meta_description || null,
    excerpt: parsed.data.excerpt || null,
    focus_keyword: parsed.data.focus_keyword || null,
    featured_image: parsed.data.featured_image || null,
    // Alt without an image is meaningless; clear it when no image is set.
    featured_image_alt: parsed.data.featured_image
      ? parsed.data.featured_image_alt || null
      : null,
    status: publish ? "published" : "draft",
    published_at: publish ? new Date().toISOString() : null,
  });
  if (error) {
    if (error.code === "23505") return SLUG_TAKEN;
    return { ok: false, error: "Could not save the post." };
  }

  // A brand-new post has no previous status, so this fires only when it was
  // created straight to published. Registered before the redirect, which
  // after() survives by design.
  triggerDeployHook(clientId, null, publish ? "published" : "draft");

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

  // Current featured image (to reap if replaced/removed), published_at (for the
  // first-publish stamp), and status + client_id (for the deploy hook, which
  // needs to know whether this post was ALREADY published: editing a live post
  // changes the public site just as much as publishing it). Same single round
  // trip either way.
  const { data: current } = await supabase
    .from("posts")
    .select("featured_image, published_at, status, client_id")
    .eq("id", id)
    .maybeSingle();

  const newFeatured = parsed.data.featured_image || null;
  const update: Record<string, string | null> = {
    title: parsed.data.title,
    meta_title: parsed.data.meta_title || null,
    excerpt: parsed.data.excerpt || null,
    focus_keyword: parsed.data.focus_keyword || null,
    slug: parsed.data.slug,
    body: parsed.data.body || null,
    meta_description: parsed.data.meta_description || null,
    featured_image: newFeatured,
    // Alt without an image is meaningless; clear it when the image is removed.
    featured_image_alt: newFeatured
      ? parsed.data.featured_image_alt || null
      : null,
    status: publish ? "published" : "draft",
  };
  if (publish) {
    update.published_at = current?.published_at ?? new Date().toISOString();
  }

  const { error } = await supabase.from("posts").update(update).eq("id", id);
  if (error) {
    if (error.code === "23505") return SLUG_TAKEN;
    return { ok: false, error: "Could not save the post." };
  }

  // Reap the replaced or removed featured image (best-effort).
  const oldFeatured = (current?.featured_image as string | null) ?? null;
  if (oldFeatured && oldFeatured !== newFeatured) {
    await reapPostImages(supabase, [oldFeatured]);
  }

  // Fires for draft -> published AND for an edit to an already-published post.
  // Skipped only when a draft is saved as a draft.
  triggerDeployHook(
    (current?.client_id as string | null) ?? null,
    (current?.status as string | null) ?? null,
    publish ? "published" : "draft"
  );

  redirect(`/c/${clientSlug}/blog`);
}

export async function deletePost(
  _previous: PostFormState,
  formData: FormData
): Promise<PostFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Missing post id." };
  const supabase = await createClient();

  // Capture the post's images before deleting, to reap them afterwards, plus
  // status and client_id for the deploy hook: once the row is gone there is
  // nothing left to tell us whether it had been public.
  const { data: post } = await supabase
    .from("posts")
    .select("featured_image, body, status, client_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("posts").delete().eq("id", id);
  if (error) return { ok: false, error: "Could not delete the post." };

  // Reap the featured and inline images (best-effort; the post is already gone).
  if (post) {
    await reapPostImages(supabase, [
      post.featured_image as string | null,
      ...inlineImageUrls(post.body as string | null),
    ]);
  }

  // Deleting a published post is the case that most needs this: without a
  // rebuild the static site keeps serving a post that no longer exists here.
  // next is null because there is no row any more.
  triggerDeployHook(
    (post?.client_id as string | null) ?? null,
    (post?.status as string | null) ?? null,
    null
  );

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
    .select("published_at, status, client_id")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase
    .from("posts")
    .update({
      status: "published",
      published_at: current?.published_at ?? new Date().toISOString(),
    })
    .eq("id", id);
  // Only on a write that actually landed: a failed update changed nothing
  // public, so asking the client's host to rebuild would be a lie.
  if (!error) {
    triggerDeployHook(
      (current?.client_id as string | null) ?? null,
      (current?.status as string | null) ?? null,
      "published"
    );
  }
  if (clientSlug) revalidatePath(`/c/${clientSlug}/blog`);
}

export async function unpublishPost(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const clientSlug = String(formData.get("client_slug") ?? "");
  if (!id) return;
  const supabase = await createClient();
  // This read is new for the deploy hook. Unpublishing is the transition whose
  // prior status the action never needed before, and the one where a missed
  // rebuild leaves a post live that the operator believes is gone.
  const { data: current } = await supabase
    .from("posts")
    .select("status, client_id")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase
    .from("posts")
    .update({ status: "draft" })
    .eq("id", id);
  if (!error) {
    triggerDeployHook(
      (current?.client_id as string | null) ?? null,
      (current?.status as string | null) ?? null,
      "draft"
    );
  }
  if (clientSlug) revalidatePath(`/c/${clientSlug}/blog`);
}
