"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setSourceDefaultClient } from "@/lib/inbound/actions";

// After assigning a request, offer to remember where that source's requests go.
//
// AN OFFER, NOT SILENT LEARNING. Inferring the rule from a single assignment
// would change where every future request from that source lands, without the
// operator choosing it and with nowhere obvious to notice or undo it. Asking
// costs one click and makes the rule something that was decided.
//
// Only shown when the source has no default yet -- once it knows, there is
// nothing to offer -- and dismissing is a real answer, not a deferral: the
// banner is gone for this assignment either way, and the same offer returns next
// time a request from that source is assigned by hand.
export function RememberSourceDefault({
  sourceApp,
  clientId,
  clientName,
}: {
  sourceApp: string;
  clientId: string;
  clientName: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (dismissed) return null;

  function remember() {
    startTransition(async () => {
      const result = await setSourceDefaultClient(sourceApp, clientId);
      if (result.ok) {
        setDismissed(true);
        // Drop the query params, so a refresh does not re-offer something
        // already answered.
        router.replace("/requests");
        router.refresh();
      } else {
        setError(result.error ?? "Could not save the default client.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-status-info/30 bg-status-info-surface p-3">
      <p className="min-w-0 flex-1 text-sm">
        Always assign <span className="font-mono text-xs">{sourceApp}</span>{" "}
        requests to <span className="font-medium">{clientName}</span>?{" "}
        <span className="text-muted-foreground">
          New ones will arrive already assigned. You can change this in Settings
          → Integrations.
        </span>
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" onClick={remember} disabled={pending}>
          <Check />
          {pending ? "Saving" : "Always"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDismissed(true);
            router.replace("/requests");
          }}
          disabled={pending}
        >
          <X />
          Not this time
        </Button>
      </div>
    </div>
  );
}
