"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { buildExampleFormHtml } from "@/lib/lead-webhooks/intake";

// A ready-made plain HTML form for a given lead form, with the real
// submission URL as its action. It posts with no JavaScript (the browser
// sends url-encoded, which the endpoint accepts), so it drops straight into
// almost any website. The absolute submission URL is resolved on the server
// from the request host and passed in, so the displayed and copied snippet
// always carry the same correct URL.
export function CopyHtmlForm({ submissionUrl }: { submissionUrl: string }) {
  const [copied, setCopied] = useState(false);
  const html = buildExampleFormHtml(submissionUrl);

  return (
    <details className="rounded-md border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        Copy a ready-made HTML form (no JavaScript)
      </summary>
      <div className="space-y-2 border-t p-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(html);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? "Copied" : "Copy form HTML"}
        </Button>
        <pre className="overflow-x-auto rounded bg-background p-3 text-xs">
          {html}
        </pre>
      </div>
    </details>
  );
}
