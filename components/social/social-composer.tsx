"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fieldInputClass } from "@/components/form-field";
import {
  SocialTargets,
  type SocialAccount,
} from "@/components/social/social-targets";
import {
  SocialMediaUploader,
  type UploaderItem,
} from "@/components/social/social-media-uploader";
import { autosaveSocialDraft, saveSocialPost } from "@/lib/social/actions";
import { londonParts } from "@/lib/social/london";
import type { PostFormat, SocialPostFormState } from "@/lib/social/schemas";

type ComposerPost = { caption: string; scheduled_at: string | null };

// Compose/edit a social post. The post id is provided by the server (stable
// across SSR/hydration) so media can upload to its storage path before save.
// "Save draft", "Schedule" and "Publish now" submit with an intent the server
// action reads; "Publish now" saves then takes it live through the engine.
export function SocialComposer({
  clientId,
  clientSlug,
  mode,
  postId,
  post,
  initialMedia,
  accounts,
  selectedTargetIds,
  defaultTime = null,
  defaultDate = null,
  initialCaptionError = null,
  hasStyledImage = false,
  format = "feed",
}: {
  clientId: string;
  clientSlug: string;
  mode: "new" | "edit";
  postId: string;
  post: ComposerPost | null;
  initialMedia: UploaderItem[];
  accounts: SocialAccount[];
  selectedTargetIds: string[];
  // This client's usual posting time (London HH:MM), derived from their most
  // recently scheduled post. Prefills the time on a NEW post only, so an
  // existing post always shows its own time and editing one never silently
  // moves it.
  defaultTime?: string | null;
  // A day the operator CHOSE, by clicking it on the calendar (London
  // YYYY-MM-DD). Prefills the date on a NEW post only, for the same reason
  // defaultTime does: an existing post always shows its own date, so editing one
  // never silently moves it.
  defaultDate?: string | null;
  // Set when a share seeded this draft but the caption generation failed, so the
  // caption is the safe fallback and the operator needs to know why.
  initialCaptionError?: string | null;
  // Whether this post already has a styled image recipe, so the way in can say
  // which it is. Absent on a new post, which has no saved row to attach one to.
  hasStyledImage?: boolean;
  // What this post IS, fixed at creation and never editable here. A story and a
  // feed post differ in caption, media count and aspect ratio, so there is no
  // coherent halfway row to flip through.
  format?: PostFormat;
}) {
  const [state, formAction, pending] = useActionState<
    SocialPostFormState,
    FormData
  >(saveSocialPost, null);

  const isStory = format === "story";

  // A STORY CAN ONLY GO TO INSTAGRAM TODAY, so Facebook accounts are not
  // offered on one. The publisher refuses a Facebook story by name rather than
  // quietly posting it to the Page timeline, but a target you can tick and
  // schedule and that is guaranteed to fail hours later is a worse way to learn
  // that than simply not being offered it.
  const usableAccounts = isStory
    ? accounts.filter((account) => account.platform === "instagram")
    : accounts;
  const hiddenFacebookCount = accounts.length - usableAccounts.length;

  const [caption, setCaption] = useState(post?.caption ?? "");
  const [media, setMedia] = useState<UploaderItem[]>(initialMedia);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    // Never start a story with a Facebook target ticked, even though the server
    // ticks every connected account by default.
    isStory
      ? selectedTargetIds.filter((id) =>
          accounts.some(
            (account) => account.id === id && account.platform === "instagram"
          )
        )
      : selectedTargetIds
  );
  const prefill = post?.scheduled_at ? londonParts(post.scheduled_at) : null;
  const [date, setDate] = useState(prefill?.date ?? defaultDate ?? "");
  // The post's own time wins; the client's usual time only fills a blank.
  //
  // The date still has no automatic default -- a time is a habit, a date is a
  // decision, and prefilling today would make "Schedule" one click from
  // publishing on a day nobody chose. defaultDate is not that: it arrives only
  // when the operator clicked a specific day on the calendar, which IS the
  // decision. Carrying it here is honouring a choice already made, not guessing.
  const [time, setTime] = useState(prefill?.time ?? defaultTime ?? "");

  // Which submit button fired, for its pending label ("Publishing…" etc).
  const [intent, setIntent] = useState<"draft" | "schedule" | "publish" | null>(
    null
  );

  // A validation error is only shown while it reflects what it was checked
  // against: changing photos or targets marks the relevant error stale. The
  // flags are keyed to the action result they were set against, so a fresh
  // result (new state object) automatically un-hides whatever it reports.
  const [stale, setStale] = useState<{
    result: SocialPostFormState;
    media: boolean;
    targets: boolean;
  }>({ result: null, media: false, targets: false });
  const mediaErrorStale = stale.result === state && stale.media;
  const targetsErrorStale = stale.result === state && stale.targets;

  function markStale(fields: { media?: boolean; targets?: boolean }) {
    setStale((previous) => {
      const kept = previous.result === state;
      return {
        result: state,
        media: (kept && previous.media) || !!fields.media,
        targets: (kept && previous.targets) || !!fields.targets,
      };
    });
  }

  const captionlessVideo =
    caption.trim() === "" && media.some((m) => m.media_type === "video");

  // Photos are only mandatory for Instagram; Facebook supports text-only posts.
  const igSelected = accounts.some(
    (account) =>
      account.platform === "instagram" && selectedIds.includes(account.id)
  );

  function toggleTarget(id: string, checked: boolean) {
    setSelectedIds((previous) =>
      checked ? [...previous, id] : previous.filter((x) => x !== id)
    );
    // The photo requirement depends on the selection, so both go stale.
    markStale({ media: true, targets: true });
  }

  // Does a row for this post exist on the server yet? Starts true in edit mode,
  // and flips on a new post the moment the first photo commits it as a draft.
  // Everything that used to be gated on `mode` is gated on this instead, because
  // "has a row" is what those things actually needed to know.
  const [exists, setExists] = useState(mode === "edit");
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  // A ref, not state: it guards against overlapping writes and nothing renders
  // from it. As state it would also mean setting state synchronously inside the
  // effect below, which is the cascading-render pattern React warns about.
  const autosaveInFlight = useRef(false);
  // The same fact as `exists`, readable inside the effect without listing it as
  // a dependency (which would re-run the effect the moment it flipped).
  const hasRow = useRef(mode === "edit");

  function changeMedia(items: UploaderItem[]) {
    setMedia(items);
    markStale({ media: true });
  }

  // A PHOTO COMMITS THE DRAFT, so the image editor has something to open.
  //
  // The editor is its own page keyed on a post id, so until a row exists the way
  // in cannot be offered at all - which put the most visual feature in the
  // module behind knowing that you had to save first, at exactly the moment you
  // were looking at the photo you wanted words on.
  //
  // AFTER THE UPLOAD BATCH SETTLES, not on each file. The uploader emits one
  // change per finished file, so firing on the first would commit the draft
  // holding one photo while the composer visibly showed three, and the editor
  // would then offer that one. Waiting for mediaUploading to fall back to false
  // means the media list is whole.
  //
  // KEEPS RUNNING while the post is still new, rather than once: photos added or
  // removed after the draft is committed have to reach the rows too, or the
  // editor drifts from the composer. Idempotent server-side, so the repeats are
  // free.
  //
  // A photo specifically, not any media: this exists to reach "text over photo",
  // and a video has nothing for it to compose onto.
  useEffect(() => {
    if (mode === "edit") return; // a real save already owns this post
    if (mediaUploading || autosaveInFlight.current) return;
    // Create on the first photo; after that keep syncing whatever the media list
    // has become, including back down to nothing. Without the second half,
    // removing every photo would leave the editor offering one the composer no
    // longer shows.
    if (!hasRow.current && !media.some((item) => item.media_type === "image")) {
      return;
    }

    let cancelled = false;
    autosaveInFlight.current = true;
    autosaveSocialDraft({
      id: postId,
      clientId,
      caption,
      media: media.map((m) => ({
        storage_path: m.storage_path,
        media_type: m.media_type,
        width: m.width,
        height: m.height,
        poster_path: m.poster_path ?? null,
      })),
      targetIds: selectedIds,
      format,
    })
      .then((result) => {
        if (result.ok) {
          // The ref is set even if this effect was cleaned up: the row exists on
          // the server either way, and forgetting that would let a later run
          // insert over it.
          hasRow.current = true;
          if (!cancelled) {
            setExists(true);
            setAutosaveError(null);
          }
        } else if (!cancelled) {
          setAutosaveError(result.error ?? "Could not start the draft.");
        }
      })
      .catch(() => {
        if (!cancelled) setAutosaveError("Could not start the draft.");
      })
      .finally(() => {
        autosaveInFlight.current = false;
      });
    return () => {
      cancelled = true;
    };
    // Caption and targets are read but deliberately NOT dependencies: this
    // syncs the PHOTOS, and re-firing on every keystroke of the caption would
    // turn typing into a write per character. Whatever the caption happens to be
    // when a photo changes is good enough for a draft, and the manual save is
    // what actually commits the words.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media, mediaUploading, mode, postId, clientId]);

  // poster_path travels with the item. Leaving it out is what made every saved
  // video a blank tile: the uploader grabs a first frame and stores it, the row
  // that would point at it was written null, and the still sat orphaned in the
  // bucket while lists and the calendar had nothing to render.
  const mediaJson = JSON.stringify(
    media.map((m) => ({
      storage_path: m.storage_path,
      media_type: m.media_type,
      width: m.width,
      height: m.height,
      poster_path: m.poster_path,
    }))
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="id" value={postId} />
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="client_slug" value={clientSlug} />
      {/* Not the `mode` prop. Once the first photo has committed the draft, the
          row exists, so the manual save has to UPDATE it - submitting "new"
          would insert over a primary key that is already there and fail the
          save with nothing on screen explaining why. */}
      <input type="hidden" name="mode" value={exists ? "edit" : "new"} />
      <input type="hidden" name="format" value={format} />
      <input type="hidden" name="media" value={mediaJson} />

      <div>
        <SocialTargets
          accounts={usableAccounts}
          selected={selectedIds}
          onToggle={toggleTarget}
        />
        {isStory && hiddenFacebookCount > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Facebook stories are not supported yet, so{" "}
            {hiddenFacebookCount === 1 ? "that Page is" : "those Pages are"} not
            offered here.
          </p>
        ) : null}
        {state?.fieldErrors?.targets && !targetsErrorStale ? (
          <p className="mt-1 text-sm text-destructive">
            {state.fieldErrors.targets[0]}
          </p>
        ) : null}
      </div>

      {/* NO CAPTION ON A STORY, and absent rather than disabled.
          None of Meta's story endpoints accepts message text, so a caption box
          here would be words the operator writes, watches save, and never sees
          anywhere. 0085 refuses one at the database. Words reach a story by
          being part of the picture, which is what the styled-image editor
          below is for. */}
      {isStory ? null : (
        <div className="space-y-1.5">
          <label htmlFor="social-caption" className="text-sm font-medium">
            Caption
          </label>
          <textarea
            id="social-caption"
            name="caption"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            rows={5}
            placeholder="Write your caption…"
            className={fieldInputClass}
          />
          {/* Share-to-social seeding only. The composer no longer generates
            captions on demand, but shareToSocial still runs a blog post through
            the generator to seed this box, and when that fails the caption is
            the safe title-plus-meta fallback. Saying so is the difference
            between "this is the caption" and "this is what you get because
            something went wrong". */}
          {initialCaptionError ? (
            <p className="text-sm text-destructive">{initialCaptionError}</p>
          ) : null}
        </div>
      )}

      <div>
        <SocialMediaUploader
          clientId={clientId}
          postId={postId}
          items={media}
          onChange={changeMedia}
          onUploadingChange={setMediaUploading}
          format={format}
          maxItems={isStory ? 1 : undefined}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {isStory
            ? "One photo or one video. 9:16 fills the screen; anything else is letterboxed. Video up to 60 seconds."
            : igSelected
              ? "Instagram needs a photo or a video. One video posts as a Reel."
              : "Media is optional for Facebook-only posts. One video posts as a Reel."}
        </p>
        {/* THE WAY IN TO THE IMAGE EDITOR.
            Here rather than on the post card in the list, because this is where
            you are already thinking about the picture -- the uploader is
            directly above it -- and because a card full of one-click icons is
            the wrong place for something that opens a workspace. It is a
            labelled block rather than an icon for the same reason: nobody
            guesses what an icon for "compose type over a photo" looks like.

            Gated on the row existing, not on edit mode. A new post has a
            client-side id and no row, so the editor page would 404 on it - but
            the first photo upload now commits the draft, so on a new post this
            block appears the moment there is a photo to put words on. */}
        {exists && media.some((m) => m.media_type === "image") ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-card border bg-card p-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                {hasStyledImage ? "Styled image" : "Make a styled image"}
              </p>
              <p className="text-xs text-muted-foreground">
                {hasStyledImage
                  ? "This post has a headline composed over a photo. Open it to change the words or the layout."
                  : "Put a big headline over one of these photos, in the house style."}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              render={<Link href={`/c/${clientSlug}/social/${postId}/image`} />}
            >
              <ImageIcon aria-hidden="true" className="size-3.5" />
              {hasStyledImage ? "Open" : "Make one"}
            </Button>
          </div>
        ) : !exists &&
          media.some((m) => m.media_type === "image") &&
          !autosaveError ? (
          // Derived rather than tracked: a photo is present but no row exists
          // yet, which is exactly the window the autosave is open in.
          <p className="mt-3 text-xs text-muted-foreground">
            Starting a draft, so the styled-image editor has something to open…
          </p>
        ) : autosaveError ? (
          // Says what actually failed and what still works. The upload itself
          // succeeded, so the photo is safe and a manual save is unaffected.
          <p className="mt-3 text-xs text-destructive">
            {autosaveError} The photo uploaded fine. Save the post and the
            styled-image editor will open as usual.
          </p>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Add a photo and you can compose a styled headline over it.
          </p>
        )}
        {state?.fieldErrors?.media && !mediaErrorStale ? (
          <p className="mt-1 text-sm text-destructive">
            {state.fieldErrors.media[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">
          Schedule for{" "}
          <span className="text-muted-foreground">(Europe/London)</span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            name="schedule_date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={cn(fieldInputClass, "w-auto")}
          />
          <input
            type="time"
            name="schedule_time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className={cn(fieldInputClass, "w-auto")}
          />
        </div>
        {state?.fieldErrors?.schedule ? (
          <p className="text-sm text-destructive">
            {state.fieldErrors.schedule[0]}
          </p>
        ) : null}
      </div>

      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {/* A WARNING, NOT A RULE. Meta accepts a Reel with no caption, so blocking
          one would be inventing a requirement that does not exist. But a silent
          captionless Reel is almost never what was meant -- it is what a post
          looks like when the caption box was forgotten between uploading the
          video and pressing Publish. Say so, and let it through. */}
      {captionlessVideo ? (
        <p className="text-sm text-status-warn">
          This video has no caption. Reels can post without one, but they rarely
          should.
        </p>
      ) : null}

      {/* Submitting mid-upload would save without the in-flight photos, so all
          three intents wait for the uploader to finish. Each button shows its
          own pending label for the full round trip (action until redirect or
          result), per the clicked intent. */}
      <div className="flex justify-end gap-2">
        <Button
          type="submit"
          name="intent"
          value="draft"
          variant="outline"
          disabled={pending || mediaUploading}
          onClick={() => setIntent("draft")}
        >
          {pending && intent === "draft" ? "Saving…" : "Save draft"}
        </Button>
        <Button
          type="submit"
          name="intent"
          value="schedule"
          variant="outline"
          disabled={pending || mediaUploading}
          onClick={() => setIntent("schedule")}
        >
          {mediaUploading
            ? "Uploading photos…"
            : pending && intent === "schedule"
              ? "Scheduling…"
              : "Schedule"}
        </Button>
        <Button
          type="submit"
          name="intent"
          value="publish"
          disabled={pending || mediaUploading}
          onClick={() => setIntent("publish")}
        >
          {pending && intent === "publish" ? "Publishing…" : "Publish now"}
        </Button>
      </div>
    </form>
  );
}
