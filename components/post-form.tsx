"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldInputClass } from "@/components/form-field";
import { PostEditor } from "@/components/post-editor";
import { FeaturedImageInput } from "@/components/featured-image-input";
import { slugify } from "@/lib/clients/schemas";
import { CharCounter } from "@/components/char-counter";
import { createPost, updatePost } from "@/lib/posts/actions";
import { SEO_LIMITS, type PostFormState } from "@/lib/posts/schemas";

export type PostFormData = {
  id: string;
  title: string;
  meta_title: string | null;
  excerpt: string | null;
  slug: string;
  body: string | null;
  meta_description: string | null;
  featured_image: string | null;
  featured_image_alt: string | null;
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
  const [metaDescription, setMetaDescription] = useState(
    post?.meta_description ?? ""
  );
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? "");

  // The meta title mirrors the title until it is edited, then detaches and keeps
  // its own value. Same shape as the slug above it, and for the same reason: a
  // sensible default you never have to think about, which stops being a default
  // the moment you disagree with it.
  //
  // The DETACHED flag is what gets stored, not the text. While attached the
  // field submits blank, so the column stays null and a later title change is
  // still followed. Storing the mirrored text instead would silently freeze the
  // meta title at whatever the headline said the day the post was written.
  const [metaTitle, setMetaTitle] = useState(post?.meta_title ?? "");
  const [metaTitleEdited, setMetaTitleEdited] = useState(
    (post?.meta_title ?? "") !== ""
  );
  const shownMetaTitle = metaTitleEdited ? metaTitle : title;

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
          <p className="text-sm text-destructive">
            {state.fieldErrors.title[0]}
          </p>
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
          <p className="text-sm text-destructive">
            {state.fieldErrors.slug[0]}
          </p>
        ) : null}
      </div>

      <FeaturedImageInput
        clientId={clientId}
        initialUrl={post?.featured_image ?? null}
        initialAlt={post?.featured_image_alt ?? null}
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
        <label htmlFor="post-meta-title" className="text-sm font-medium">
          Meta title{" "}
          <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          id="post-meta-title"
          // Submits blank while it is still mirroring the title, so the column
          // stays null and keeps following the headline.
          name="meta_title"
          value={metaTitleEdited ? metaTitle : ""}
          // The visible text is the mirror; the submitted value is above.
          onChange={(event) => {
            setMetaTitle(event.target.value);
            setMetaTitleEdited(true);
          }}
          placeholder={title || "Follows the post title"}
          className={fieldInputClass}
        />
        <CharCounter
          value={shownMetaTitle}
          limit={SEO_LIMITS.metaTitle}
          warnAt={SEO_LIMITS.metaTitleWarnAt}
          hint={
            metaTitleEdited
              ? "What search results show."
              : "Following the post title. Type to set your own."
          }
        />
        {metaTitleEdited ? (
          <button
            type="button"
            onClick={() => {
              setMetaTitleEdited(false);
              setMetaTitle("");
            }}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Follow the post title again
          </button>
        ) : null}
        {state?.fieldErrors?.meta_title ? (
          <p className="text-sm text-destructive">
            {state.fieldErrors.meta_title[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="post-meta" className="text-sm font-medium">
          Meta description{" "}
          <span className="text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="post-meta"
          name="meta_description"
          value={metaDescription}
          onChange={(event) => setMetaDescription(event.target.value)}
          rows={2}
          className={fieldInputClass}
        />
        <CharCounter
          value={metaDescription}
          limit={SEO_LIMITS.metaDescription}
          warnAt={SEO_LIMITS.metaDescriptionWarnAt}
          hint="What search results show under the title."
        />
        {state?.fieldErrors?.meta_description ? (
          <p className="text-sm text-destructive">
            {state.fieldErrors.meta_description[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="post-excerpt" className="text-sm font-medium">
          Excerpt <span className="text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="post-excerpt"
          name="excerpt"
          value={excerpt}
          onChange={(event) => setExcerpt(event.target.value)}
          rows={3}
          className={fieldInputClass}
        />
        <CharCounter
          value={excerpt}
          limit={SEO_LIMITS.excerpt}
          warnAt={SEO_LIMITS.excerptWarnAt}
          hint="The summary a blog index or card shows. Not the meta description."
        />
        {state?.fieldErrors?.excerpt ? (
          <p className="text-sm text-destructive">
            {state.fieldErrors.excerpt[0]}
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
