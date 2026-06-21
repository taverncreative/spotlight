"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { MAX_FILE_SIZE_BYTES, type RELATED_TYPES } from "@/lib/files/schemas";
import {
  prepareFileUpload,
  recordFile,
} from "@/app/app/[orgSlug]/files/actions";

// The upload control (Pass 8C). It runs the browser-direct flow built in Pass
// 8B: ask the server to build the workspace-scoped path (prepareFileUpload),
// upload the bytes straight to storage on the user session, then record the
// metadata (recordFile) and refresh the list. The size is checked client-side
// for a friendly message before any work, on top of the storage bucket limit
// and the recordFile schema cap that already enforce it server-side. The file
// is linked to this record automatically (the related pair is bound here, never
// chosen by the user).

const BUCKET = "attachments";
const MAX_LABEL = "25 MiB";

type RelatedType = (typeof RELATED_TYPES)[number];

export function FileUpload({
  orgSlug,
  recordType,
  recordId,
}: {
  orgSlug: string;
  recordType: RelatedType;
  recordId: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function upload() {
    if (!file || uploading) return;
    setError(null);
    setSuccess(null);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`That file is too large. The limit is ${MAX_LABEL}.`);
      return;
    }

    setUploading(true);
    try {
      const prepared = await prepareFileUpload(orgSlug, {
        related_type: recordType,
        related_id: recordId,
        filename: file.name,
      });
      if (!prepared) {
        setError("This record is no longer available.");
        return;
      }

      const supabase = createClient();
      const uploaded = await supabase.storage
        .from(BUCKET)
        .upload(prepared.storage_path, file, {
          contentType: file.type || undefined,
        });
      if (uploaded.error) {
        const tooLarge = /exceeded the maximum|413|too large/i.test(
          uploaded.error.message
        );
        setError(
          tooLarge
            ? `That file is too large. The limit is ${MAX_LABEL}.`
            : "The upload failed. Please try again."
        );
        return;
      }

      const recorded = await recordFile(orgSlug, {
        related_type: recordType,
        related_id: recordId,
        filename: file.name,
        storage_path: prepared.storage_path,
        size_bytes: file.size,
        mime_type: file.type || null,
      });
      if (!recorded) {
        setError("This record is no longer available.");
        return;
      }

      setSuccess(`Uploaded ${file.name}.`);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch {
      setError("The upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-4">
      <p className="text-sm font-medium">Add a file</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          aria-label="Choose a file"
          disabled={uploading}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError(null);
            setSuccess(null);
          }}
          className="text-sm"
        />
        <Button
          type="button"
          size="sm"
          onClick={upload}
          disabled={!file || uploading}
        >
          {uploading ? "Uploading" : "Upload"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Maximum file size {MAX_LABEL}.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {success}
        </p>
      ) : null}
    </div>
  );
}
