"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldInputClass } from "@/components/form-field";
import { PostEditor } from "@/components/post-editor";
import { FeaturedImageInput } from "@/components/featured-image-input";
import { slugify } from "@/lib/clients/schemas";
import { createPost, updatePost } from "@/lib/posts/actions";
import type { PostFormState } from "@/lib/posts/schemas";

export type PostFormData = {
  id: string;
  title: string;
  slug: string;
  body: string | null;
  meta_description: string | null;
  featured_image: string | null;
};

// Compose/edit form. post === null is the create case (uses clientId); otherwise
// it is pre-filled for editing. The slug auto-derives from the title until the
// operator edits it. "Save draft" and "Publish" submit with an intent the
// server action reads. On success the action redirects to the blog list.
export function PostForm({
  clientId,
  clientSlug,
  post,
}: {
  clientId: string;
  clientSlug: string;
  post: PostFormData | null;
}) {
  const isEdit = post !== null;
  const action = isEdit ? updatePost : createPost;
  const [state, formAction, pending] = useActionState<PostFormState, FormData>(
    action,
    null
  );

  const [title, setTitle] = useState(post?.title ?? "");
  const [slug, setSlug] = useState(post?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(isEdit);
  const [body, setBody] = useState(post?.body ?? "");

  function handleTitleChange(value: string) {
    setTitle(value);
    if (!slugEdited) setSlug(slugify(value));
  }

  return (
    <form action={formAction} className="space-y-4">
      {post ? (
        <input type="hidden" name="id" value={post.id} />
      ) : (
        <input type="hidden" name="client_id" value={clientId} />
      )}
      <input type="hidden" name="client_slug" value={clientSlug} />

      <div className="space-y-1.5">
        <label htmlFor="post-title" className="text-sm font-medium">
          Title
        </label>
        <input
          id="post-title"
          name="title"
          value={title}
          onChange={(event) => handleTitleChange(event.target.value)}
          autoFocus
          required
          className={fieldInputClass}
        />
        {state?.fieldErrors?.title ? (
          <p className="text-sm text-destructive">{state.fieldErrors.title[0]}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="post-slug" className="text-sm font-medium">
          Slug
        </label>
        <input
          id="post-slug"
          name="slug"
          value={slug}
          onChange={(event) => {
            setSlug(event.target.value);
            setSlugEdited(true);
          }}
          required
          className={`${fieldInputClass} font-mono`}
        />
        <p className="text-xs text-muted-foreground">/{slug || "your-post"}</p>
        {state?.fieldErrors?.slug ? (
          <p className="text-sm text-destructive">{state.fieldErrors.slug[0]}</p>
        ) : null}
      </div>

      <FeaturedImageInput
        clientId={clientId}
        initialUrl={post?.featured_image ?? null}
      />

      <div className="space-y-1.5">
        <label className="text-sm font-medium">
          Body{" "}
          <span className="text-muted-foreground">
            (rich text, saved as Markdown)
          </span>
        </label>
        <input type="hidden" name="body" value={body} />
        <PostEditor
          clientId={clientId}
          initialMarkdown={post?.body ?? ""}
          onChange={setBody}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="post-meta" className="text-sm font-medium">
          Meta description{" "}
          <span className="text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="post-meta"
          name="meta_description"
          defaultValue={post?.meta_description ?? ""}
          rows={2}
          className={fieldInputClass}
        />
        {state?.fieldErrors?.meta_description ? (
          <p className="text-sm text-destructive">
            {state.fieldErrors.meta_description[0]}
          </p>
        ) : null}
      </div>

      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button
          type="submit"
          name="intent"
          value="draft"
          variant="outline"
          disabled={pending}
        >
          Save draft
        </Button>
        <Button type="submit" name="intent" value="publish" disabled={pending}>
          Publish
        </Button>
      </div>
    </form>
  );
}
