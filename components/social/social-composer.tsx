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
import { saveSocialPost } from "@/lib/social/actions";
import type { SocialPostFormState } from "@/lib/social/schemas";

type ComposerPost = { caption: string; scheduled_at: string | null };

// The Europe/London wall-clock date + time for a UTC ISO, to prefill the
// schedule inputs on edit. Intl with an IANA zone is deterministic across server
// and client, so this is hydration-safe.
function londonParts(iso: string): { date: string; time: string } {
  const parts: Record<string, string> = {};
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  for (const part of fmt.formatToParts(new Date(iso)))
    parts[part.type] = part.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

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
  const [media, setMedia] = useState<UploaderItem[]>(initialMedia);
  const [selectedIds, setSelectedIds] = useState<string[]>(selectedTargetIds);
  const prefill = post?.scheduled_at ? londonParts(post.scheduled_at) : null;
  const [date, setDate] = useState(prefill?.date ?? "");
  const [time, setTime] = useState(prefill?.time ?? "");

  // Photos are only mandatory for Instagram; Facebook supports text-only posts.
  const igSelected = accounts.some(
    (account) =>
      account.platform === "instagram" && selectedIds.includes(account.id)
  );

  function toggleTarget(id: string, checked: boolean) {
    setSelectedIds((previous) =>
      checked ? [...previous, id] : previous.filter((x) => x !== id)
    );
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
        {state?.fieldErrors?.targets ? (
          <p className="mt-1 text-sm text-destructive">
            {state.fieldErrors.targets[0]}
          </p>
        ) : null}
      </div>

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
      </div>

      <div>
        <SocialMediaUploader
          clientId={clientId}
          postId={postId}
          items={media}
          onChange={setMedia}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {igSelected
            ? "Instagram requires at least one photo."
            : "Photos are optional for Facebook-only posts."}
        </p>
        {state?.fieldErrors?.media ? (
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
        <Button
          type="submit"
          name="intent"
          value="schedule"
          variant="outline"
          disabled={pending}
        >
          Schedule
        </Button>
        <Button type="submit" name="intent" value="publish" disabled={pending}>
          Publish now
        </Button>
      </div>
    </form>
  );
}
