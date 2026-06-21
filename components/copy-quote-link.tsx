"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// Shows the quote's public link with a copy control, for the manual
// send-by-email workflow. The absolute URL comes from the browser so it
// matches whatever host the app is served on.
export function CopyQuoteLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/q/${token}`;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground">
        Public link
      </span>
      <code className="max-w-60 truncate text-xs">{path}</code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(
            `${window.location.origin}${path}`
          );
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}
