"use client";

import { useActionState, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fieldInputClass } from "@/components/form-field";
import {
  SocialTargets,
  type MetaAccount,
} from "@/components/social/social-targets";
import {
  SocialMediaUploader,
  type UploaderItem,
} from "@/components/social/social-media-uploader";
import { GenerateCaptionButton } from "@/components/social/generate-caption-button";
import { saveSocialPost } from "@/lib/social/actions";
import { londonParts } from "@/lib/social/london";
import type { SocialPostFormState } from "@/lib/social/schemas";

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
}: {
  clientId: string;
  clientSlug: string;
  mode: "new" | "edit";
  postId: string;
  post: ComposerPost | null;
  initialMedia: UploaderItem[];
  accounts: MetaAccount[];
  selectedTargetIds: string[];
}) {
  const [state, formAction, pending] = useActionState<
    SocialPostFormState,
    FormData
  >(saveSocialPost, null);

  const [caption, setCaption] = useState(post?.caption ?? "");
  // Generator failures only: shown under the textarea, never clearing the box.
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [media, setMedia] = useState<UploaderItem[]>(initialMedia);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(selectedTargetIds);
  const prefill = post?.scheduled_at ? londonParts(post.scheduled_at) : null;
  const [date, setDate] = useState(prefill?.date ?? "");
  const [time, setTime] = useState(prefill?.time ?? "");

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

  function changeMedia(items: UploaderItem[]) {
    setMedia(items);
    markStale({ media: true });
  }

  const mediaJson = JSON.stringify(
    media.map((m) => ({
      storage_path: m.storage_path,
      media_type: m.media_type,
      width: m.width,
      height: m.height,
    }))
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="id" value={postId} />
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="client_slug" value={clientSlug} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="media" value={mediaJson} />

      <div>
        <SocialTargets
          accounts={accounts}
          selected={selectedIds}
          onToggle={toggleTarget}
        />
        {state?.fieldErrors?.targets && !targetsErrorStale ? (
          <p className="mt-1 text-sm text-destructive">
            {state.fieldErrors.targets[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="social-caption" className="text-sm font-medium">
            Caption
          </label>
          <GenerateCaptionButton
            value={caption}
            onGenerated={setCaption}
            onError={setCaptionError}
          />
        </div>
        <textarea
          id="social-caption"
          name="caption"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          rows={5}
          placeholder="Write your caption…"
          className={fieldInputClass}
        />
        {captionError ? (
          <p className="text-sm text-destructive">{captionError}</p>
        ) : null}
      </div>

      <div>
        <SocialMediaUploader
          clientId={clientId}
          postId={postId}
          items={media}
          onChange={changeMedia}
          onUploadingChange={setMediaUploading}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {igSelected
            ? "Instagram requires at least one photo."
            : "Photos are optional for Facebook-only posts."}
        </p>
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
