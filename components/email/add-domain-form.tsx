"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { fieldInputClass } from "@/components/form-field";
import { CopyField } from "@/components/email/copy-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { createDomain } from "@/lib/dmarc/actions";

// Add a monitored domain: the operator enters just the domain, and on success a
// dialog reveals the generated address and the rua= fragment to paste. The
// fragment is the append path (keep your current policy); the whole flow then
// closes and the new domain appears on the page in its pending state.
export function AddDomainForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [domain, setDomain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    domain: string;
    ingestAddress: string;
    ruaFragment: string;
  } | null>(null);

  function add() {
    setError(null);
    startTransition(async () => {
      const result = await createDomain(domain);
      if (result.ok) {
        setCreated({
          domain: result.domain,
          ingestAddress: result.ingestAddress,
          ruaFragment: result.ruaFragment,
        });
        setDomain("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && domain.trim() !== "") add();
          }}
          placeholder="acme.co.uk"
          aria-label="Domain to monitor"
          className={`${fieldInputClass} w-auto flex-1 font-mono`}
        />
        <Button
          size="sm"
          onClick={add}
          disabled={pending || domain.trim() === ""}
        >
          {pending ? "Adding…" : "Add domain"}
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Dialog
        open={created !== null}
        onOpenChange={(open) => {
          if (!open) setCreated(null);
        }}
      >
        <DialogContent>
          <div className="space-y-1">
            <DialogTitle>Monitoring {created?.domain}</DialogTitle>
            <DialogDescription>
              Add this <span className="font-mono">rua=</span> target to the
              DMARC record at{" "}
              <span className="font-mono">{`_dmarc.${created?.domain}`}</span>.
              Keep your current policy: if a record already exists, leave its{" "}
              <span className="font-mono">p=</span> as-is and merge only this
              in.
            </DialogDescription>
          </div>
          <div className="space-y-3">
            {created ? (
              <CopyField
                value={created.ruaFragment}
                note="Reports flow to this address once DNS propagates. The domain is listed below, awaiting its first report."
              />
            ) : null}
            <div className="flex justify-end">
              <Button onClick={() => setCreated(null)}>Done</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
