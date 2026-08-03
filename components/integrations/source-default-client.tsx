"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSourceDefaultClient } from "@/lib/inbound/actions";
import { fieldInputClass } from "@/components/form-field";

// Which client this source's requests are filed under automatically.
//
// A select that saves on change rather than a form with a button: there is one
// field and no way to get it half-right, so a Save step would only add a way to
// forget. "Ask each time" is the empty value and a real choice, not a blank.
//
// The rule applies to every LIVE row sharing this source_app -- see
// setSourceDefaultClient -- so the control is keyed on the name, not the row.
export function SourceDefaultClient({
  sourceApp,
  defaultClientId,
  clients,
}: {
  sourceApp: string;
  defaultClientId: string | null;
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (clients.length === 0) return null;

  function change(value: string) {
    setError(null);
    startTransition(async () => {
      const result = await setSourceDefaultClient(sourceApp, value || null);
      if (result.ok) router.refresh();
      else setError(result.error ?? "Could not save the default client.");
    });
  }

  return (
    <div className="space-y-1">
      <label
        htmlFor={`default-client-${sourceApp}`}
        className="text-xs text-muted-foreground"
      >
        Files requests under
      </label>
      <select
        id={`default-client-${sourceApp}`}
        defaultValue={defaultClientId ?? ""}
        disabled={pending}
        onChange={(event) => change(event.target.value)}
        className={`${fieldInputClass} h-8 w-auto py-0 text-xs`}
      >
        <option value="">Ask each time</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
