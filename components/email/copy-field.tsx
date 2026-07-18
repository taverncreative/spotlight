"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// A copy-exact value with a Copy button. The value shown IS the value copied --
// no interpolation or re-derivation at this boundary -- so a DNS fragment the
// operator pastes is byte-identical to what was generated and stored. The
// optional host line labels which DNS name it belongs at.
export function CopyField({
  value,
  host,
  note,
}: {
  value: string;
  host?: string;
  note?: string;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-1">
      {host ? (
        <p className="font-mono text-xs text-muted-foreground break-all">
          {host}
        </p>
      ) : null}
      <div className="flex items-stretch gap-2">
        <code className="block flex-1 rounded-control border bg-muted px-3 py-2 font-mono text-xs break-all">
          {value}
        </code>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
