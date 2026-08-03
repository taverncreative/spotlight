"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldInputClass } from "@/components/form-field";
import { cn } from "@/lib/utils";
import { PostEditor } from "@/components/post-editor";
import { FeaturedImageInput } from "@/components/featured-image-input";
import { slugify } from "@/lib/clients/schemas";
import { CharCounter } from "@/components/char-counter";
import { StructuredDataEditor } from "@/components/structured-data-editor";
import { SeoChecklist } from "@/components/seo-checklist";
import { createPost, updatePost } from "@/lib/posts/actions";
// TYPE-ONLY on purpose. seo-context.ts imports the server Supabase client, and
// importing a value from it here would pull server code into the client bundle
// -- the same boundary mistake that once turned a shared constant into an empty
// object at runtime. A type import is erased, so nothing crosses.
import type { SeoContext } from "@/lib/posts/seo-context";
import {
  faqEntries,
  parseSchemas,
  schemasFromForm,
  type FaqEntry,
} from "@/lib/posts/structured-data";
import { SEO_LIMITS, type PostFormState } from "@/lib/posts/schemas";

export type PostFormData = {
  id: string;
  title: string;
  meta_title: string | null;
  excerpt: string | null;
  focus_keyword: string | null;
  planned_for: string | null;
  slug: string;
  body: string | null;
  meta_description: string | null;
  featured_image: string | null;
  featured_image_alt: string | null;
  // Raw jsonb from the posts row; parsed into editor rows on mount.
  schemas: unknown;
};

// Compose/edit form. post === null is the create case (uses clientId); otherwise
// it is pre-filled for editing. The slug auto-derives from the title until the
// operator edits it. "Save draft" and "Publish" submit with an intent the
// server action reads. On success the action redirects to the blog list.
export function PostForm({
  clientId,
  clientSlug,
  post,
  // Which hosts count as the client's own, for the internal-link check. Fetched
  // server-side and REQUIRED, so a page cannot quietly omit it and leave the
  // link check permanently failing.
  seoContext,
  // Days since publication, or null for a draft. Passed in rather than read from
  // a clock here so the scorer stays pure and a post scores the same every time
  // it renders. Only decides whether the "is this still accurate" prompt shows.
  ageDays = null,
  defaultPlannedFor = null,
}: {
  clientId: string;
  clientSlug: string;
  post: PostFormData | null;
  seoContext: SeoContext;
  ageDays?: number | null;
  // A day the operator chose by clicking it on the calendar (YYYY-MM-DD).
  defaultPlannedFor?: string | null;
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
  const [focusKeyword, setFocusKeyword] = useState(post?.focus_keyword ?? "");
  // The post's own planned date wins. defaultPlannedFor only fills a blank on a
  // NEW post, and only ever carries a day the operator clicked on the calendar,
  // so editing an existing post never silently moves it.
  const [plannedFor, setPlannedFor] = useState(
    post?.planned_for ?? defaultPlannedFor ?? ""
  );
  const [faq, setFaq] = useState<FaqEntry[]>(() =>
    faqEntries(parseSchemas(post?.schemas))
  );
  // Mirrored from FeaturedImageInput so the checklist can score the image and
  // its alt as they change, rather than as they were when the form mounted.
  const [featured, setFeatured] = useState<{ url: string | null; alt: string }>(
    {
      url: post?.featured_image ?? null,
      alt: post?.featured_image_alt ?? "",
    }
  );

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
        onChange={setFeatured}
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
          Meta title <span className="text-muted-foreground">(optional)</span>
        </label>
        {/* The SUBMITTED value, separate from the visible one. Blank while the
            field is still mirroring, so the column stays null and keeps
            following the headline. */}
        <input
          type="hidden"
          name="meta_title"
          value={metaTitleEdited ? metaTitle : ""}
        />
        {/* The visible field carries the mirrored text as a real value, not a
            placeholder. That is the difference between overwriting and editing:
            with a placeholder the box is empty, so clicking in and typing starts
            from nothing and the usual move -- keep the title, add "Therapy
            Canterbury" on the end -- is impossible. With the text actually in
            the field you can put the cursor anywhere in it. The first keystroke
            detaches, carrying whatever is in the box at that moment. */}
        <input
          id="post-meta-title"
          value={shownMetaTitle}
          onChange={(event) => {
            setMetaTitle(event.target.value);
            setMetaTitleEdited(true);
          }}
          placeholder="Follows the post title"
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

      <div className="space-y-1.5">
        <label htmlFor="post-focus-keyword" className="text-sm font-medium">
          Focus keyword{" "}
          <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          id="post-focus-keyword"
          name="focus_keyword"
          value={focusKeyword}
          onChange={(event) => setFocusKeyword(event.target.value)}
          placeholder="balayage aftercare"
          className={fieldInputClass}
        />
        <p className="text-xs text-muted-foreground">
          The phrase this post is written to rank for. Everything below is
          scored against it.
        </p>
        {state?.fieldErrors?.focus_keyword ? (
          <p className="text-sm text-destructive">
            {state.fieldErrors.focus_keyword[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="post-planned-for" className="text-sm font-medium">
          Planned for <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          id="post-planned-for"
          name="planned_for"
          type="date"
          value={plannedFor}
          onChange={(event) => setPlannedFor(event.target.value)}
          className={cn(fieldInputClass, "w-auto")}
        />
        {/* The wording matters. This field must never be mistaken for
            scheduling: nothing publishes because the date arrives, and a post
            planned for a date that has passed is a plan that slipped, not a job
            that failed. */}
        <p className="text-xs text-muted-foreground">
          An intended date, so the post shows on the calendar before it goes
          out. Nothing publishes automatically &mdash; you still press Publish.
        </p>
        {state?.fieldErrors?.planned_for ? (
          <p className="text-sm text-destructive">
            {state.fieldErrors.planned_for[0]}
          </p>
        ) : null}
      </div>

      {/* Scored live from the form's own state, so it moves as you write rather
          than only after a save. */}
      <StructuredDataEditor entries={faq} onChange={setFaq} />

      <SeoChecklist
        input={{
          focusKeyword: focusKeyword,
          title,
          metaTitle: metaTitleEdited ? metaTitle : null,
          slug,
          metaDescription,
          body,
          featuredImage: featured.url,
          featuredImageAlt: featured.alt,
          siteUrls: seoContext.siteUrls,
          blogBaseUrl: seoContext.blogBaseUrl,
          // What the operator authored, rebuilt from the live rows so the
          // checklist note tracks the panel above as it is edited. Article is
          // never in here: it is composed at read time.
          schemas: schemasFromForm(faq),
          ageDays,
        }}
      />

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
