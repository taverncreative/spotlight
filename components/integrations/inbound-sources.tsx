"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fieldInputClass } from "@/components/form-field";
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
import {
  generateInboundSource,
  revokeInboundSource,
} from "@/lib/inbound/actions";

export type InboundSourceRow = {
  id: string;
  source_app: string;
  label: string | null;
  secret_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Inbound source secrets: the apps allowed to POST into the triage list.
// Operator-level, so this lives on Integrations rather than under a client.
//
// Mirrors ContentApiKeys: generate opens a reveal-once dialog with the plaintext
// (never re-fetchable, only its hash is stored), revoke asks first. The reveal
// also shows the normalised source_app, because the name is slugified server-side
// and the operator should see what was actually stored rather than what they
// typed.
//
// Revoked rows stay listed rather than being filtered out: revoked_at is a
// timestamp instead of a delete precisely so it stays auditable, and "when did we
// cut this off, and had it ever been used" is a real question.
export function InboundSources({ sources }: { sources: InboundSourceRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sourceApp, setSourceApp] = useState("");
  const [label, setLabel] = useState("");
  const [revealed, setRevealed] = useState<{
    secret: string;
    sourceApp: string;
  } | null>(null);
  const [revoking, setRevoking] = useState<InboundSourceRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  function generate() {
    setError(null);
    startTransition(async () => {
      const result = await generateInboundSource(sourceApp, label);
      if (result.ok) {
        setRevealed({ secret: result.secret, sourceApp: result.sourceApp });
        setSourceApp("");
        setLabel("");
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
      const result = await revokeInboundSource(id);
      if (result.ok) {
        setRevoking(null);
        router.refresh();
      } else {
        setError(result.error ?? "Could not revoke the source.");
      }
    });
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">
        Inbound sources
      </h2>
      <p className="text-xs text-muted-foreground">
        A secret lets another app post client requests into your triage list. The
        name is tidied to a slug (GEM CRM becomes gem-crm) and identifies the
        sender on every request it files. Rotating? Generate a second secret for
        the same name, switch the app over, then revoke the old one — both keep
        working in the meantime.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={sourceApp}
          onChange={(event) => setSourceApp(event.target.value)}
          placeholder="gem-crm"
          maxLength={64}
          aria-label="Source name"
          className={`${fieldInputClass} w-auto flex-1 font-mono`}
        />
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="GEM CRM production"
          maxLength={200}
          aria-label="Label"
          className={`${fieldInputClass} w-auto flex-1`}
        />
        <Button
          size="sm"
          onClick={generate}
          disabled={pending || sourceApp.trim() === ""}
        >
          {pending && revealed === null ? "Generating…" : "Generate secret"}
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {sources.length === 0 ? (
        <p className="rounded-card border bg-card p-4 text-sm text-muted-foreground">
          No inbound sources yet. Generate a secret to let another app post
          requests into your triage list.
        </p>
      ) : (
        <ul className="grid gap-2">
          {sources.map((source) => {
            const revoked = source.revoked_at !== null;
            return (
              <li
                key={source.id}
                className={`flex items-center justify-between gap-3 rounded-card border bg-card px-4 py-3 ${
                  revoked ? "opacity-60" : ""
                }`}
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate font-mono text-sm">
                    {source.source_app}
                  </p>
                  {source.label ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {source.label}
                    </p>
                  ) : null}
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {source.secret_prefix}…
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Created {formatDate(source.created_at)} ·{" "}
                    {source.last_used_at
                      ? `Last used ${formatDate(source.last_used_at)}`
                      : "Never used"}
                    {revoked ? ` · Revoked ${formatDate(source.revoked_at!)}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={revoked ? "secondary" : "success"}>
                    {revoked ? "Revoked" : "Active"}
                  </Badge>
                  {revoked ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setError(null);
                        setRevoking(source);
                      }}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={revealed !== null}
        onOpenChange={(open) => {
          if (!open) setRevealed(null);
        }}
      >
        <DialogContent>
          <div className="space-y-1">
            <DialogTitle>Secret for {revealed?.sourceApp}</DialogTitle>
            <DialogDescription>
              Copy it now — this is the only time it is shown. It is stored
              hashed and cannot be retrieved again. Send it to the app as the
              Authorization: Bearer token.
            </DialogDescription>
          </div>
          <div className="space-y-3">
            <code className="block rounded-control border bg-muted px-3 py-2 font-mono text-sm break-all">
              {revealed?.secret}
            </code>
            <p className="text-xs text-muted-foreground">
              Stored under the name{" "}
              <span className="font-mono">{revealed?.sourceApp}</span>, which is
              what its requests will be filed against.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (revealed) navigator.clipboard?.writeText(revealed.secret);
                }}
              >
                Copy
              </Button>
              <Button onClick={() => setRevealed(null)}>Done</Button>
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
            <AlertDialogTitle>Revoke this secret?</AlertDialogTitle>
            <AlertDialogDescription>
              {revoking?.source_app} loses access immediately, and any request it
              sends afterwards is rejected and lost. This cannot be undone.
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
