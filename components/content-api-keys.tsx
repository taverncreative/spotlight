"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { generateApiKey, revokeApiKey } from "@/lib/content-api/actions";

export type ApiKeyRow = {
  id: string;
  key_prefix: string;
  label: string | null;
  created_at: string;
  revoked_at: string | null;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Content API read keys for one client. Generate opens a reveal-once dialog with
// the plaintext (never re-fetchable); revoke is immediate. Rotation is just
// generate-then-revoke, with an overlap while both are active -- the copy says
// so. All actions are RLS/requireClient-guarded server actions.
export function ContentApiKeys({
  clientSlug,
  keys,
}: {
  clientSlug: string;
  keys: ApiKeyRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = keys.filter((k) => !k.revoked_at);

  function generate() {
    setError(null);
    startTransition(async () => {
      const result = await generateApiKey(clientSlug, "");
      if (result.ok) {
        setRevealKey(result.key);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function confirmRevoke() {
    if (!revoking) return;
    const id = revoking.id;
    startTransition(async () => {
      const result = await revokeApiKey(clientSlug, id);
      if (result.ok) {
        setRevoking(null);
        router.refresh();
      } else {
        setError(result.error ?? "Could not revoke the key.");
      }
    });
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Content API
        </h2>
        <Button size="sm" onClick={generate} disabled={pending}>
          {pending && revealKey === null ? "Generating…" : "Generate key"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        A read key lets a site pull this client&apos;s published posts.
        Rotating? Generate a new key, switch the site over, then revoke the old
        one — both keep working in the meantime.
      </p>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {active.length === 0 ? (
        <p className="rounded-card border bg-card p-4 text-sm text-muted-foreground">
          No keys yet. Generate one to let a site pull this client&apos;s
          published posts.
        </p>
      ) : (
        <ul className="grid gap-2">
          {active.map((k) => (
            <li
              key={k.id}
              className="flex items-center justify-between gap-3 rounded-card border bg-card px-4 py-3"
            >
              <div className="min-w-0 space-y-1">
                <p className="truncate font-mono text-sm">{k.key_prefix}…</p>
                <p className="text-xs text-muted-foreground">
                  Created {formatDate(k.created_at)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="success">Active</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setRevoking(k);
                  }}
                >
                  Revoke
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={revealKey !== null}
        onOpenChange={(open) => {
          if (!open) setRevealKey(null);
        }}
      >
        <DialogContent>
          <div className="space-y-1">
            <DialogTitle>Your new API key</DialogTitle>
            <DialogDescription>
              Copy it now — this is the only time it is shown. It is stored
              hashed and cannot be retrieved again.
            </DialogDescription>
          </div>
          <div className="space-y-3">
            <code className="block rounded-control border bg-muted px-3 py-2 font-mono text-sm break-all">
              {revealKey}
            </code>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (revealKey) navigator.clipboard?.writeText(revealKey);
                }}
              >
                Copy
              </Button>
              <Button onClick={() => setRevealKey(null)}>Done</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
      >
        <AlertDialogContent size="sm">
          <div className="space-y-2">
            <AlertDialogTitle>Revoke this key?</AlertDialogTitle>
            <AlertDialogDescription>
              Any site using {revoking?.key_prefix}… loses access immediately.
              This cannot be undone.
            </AlertDialogDescription>
          </div>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              onClick={confirmRevoke}
              disabled={pending}
            >
              {pending ? "Revoking…" : "Revoke"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
