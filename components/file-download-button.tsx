"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createFileDownloadUrl } from "@/app/app/[orgSlug]/files/actions";

// The download control (Pass 8C), for all members including read_only. It asks
// the server for a short-lived signed URL (createFileDownloadUrl, gated
// record.read, signed on the user session so storage confirms the read), fetches
// the bytes and saves them with the original filename. Fetching to a blob and
// clicking an in-page object URL keeps the suggested filename, which a direct
// cross-origin link to the signed URL would not.

export function FileDownloadButton({
  orgSlug,
  fileId,
  filename,
}: {
  orgSlug: string;
  fileId: string;
  filename: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createFileDownloadUrl(orgSlug, { id: fileId });
      if (!result) {
        setError("This file is no longer available.");
        return;
      }
      const response = await fetch(result.signedUrl);
      if (!response.ok) {
        setError("The download failed. Please try again.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("The download failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={download}
        disabled={busy}
      >
        {busy ? "Preparing" : "Download"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
