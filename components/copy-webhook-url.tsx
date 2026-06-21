"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// Shows a form's full public submission URL with a copy control. The absolute
// URL is built from the browser origin so it matches whatever host the app is
// served on, the same approach as the quote link.
export function CopyWebhookUrl({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/api/lead-webhooks/${token}`;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground">
        Submission URL
      </span>
      <code className="max-w-[28rem] truncate text-xs">{path}</code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="ml-auto"
        onClick={async () => {
          await navigator.clipboard.writeText(
            `${window.location.origin}${path}`
          );
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied" : "Copy URL"}
      </Button>
    </div>
  );
}
