"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { fieldInputClass } from "@/components/form-field";
import {
  addKnownSender,
  removeKnownSender,
  updateKnownSender,
  type KnownSenderFields,
} from "@/lib/dmarc/actions";

export type KnownSenderRow = {
  id: string;
  label: string;
  dkim_selector: string;
  dkim_domain: string;
  envelope_domain: string | null;
};

const EMPTY: KnownSenderFields = {
  label: "",
  dkim_selector: "",
  dkim_domain: "",
  envelope_domain: "",
};

// The per-domain known senders: what classification matches a report's DKIM
// against. Add, edit and remove inline. Edits apply to NEW reports only -- a
// stored record keeps the classification it was given at ingest -- so the note
// says so rather than implying the history re-colours.
export function KnownSendersEditor({
  domainId,
  senders,
}: {
  domainId: string;
  senders: KnownSenderRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<KnownSenderFields>(EMPTY);
  const [adding, setAdding] = useState<KnownSenderFields>(EMPTY);

  function beginEdit(row: KnownSenderRow) {
    setError(null);
    setEditingId(row.id);
    setDraft({
      label: row.label,
      dkim_selector: row.dkim_selector,
      dkim_domain: row.dkim_domain,
      envelope_domain: row.envelope_domain ?? "",
    });
  }

  function saveEdit(id: string) {
    startTransition(async () => {
      const result = await updateKnownSender(id, draft);
      if (result.ok) {
        setEditingId(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await removeKnownSender(id);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function add() {
    setError(null);
    startTransition(async () => {
      const result = await addKnownSender(domainId, adding);
      if (result.ok) {
        setAdding(EMPTY);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Known senders</p>
        <p className="text-xs text-muted-foreground">
          Matched by DKIM selector and domain. Changes apply to new reports;
          stored history keeps the state it was classified with.
        </p>
      </div>

      {senders.length === 0 ? (
        <p className="text-xs text-muted-foreground">No known senders yet.</p>
      ) : (
        <ul className="space-y-2">
          {senders.map((row) =>
            editingId === row.id ? (
              <li key={row.id} className="space-y-2 rounded-control border p-2">
                <SenderFields values={draft} onChange={setDraft} />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => saveEdit(row.id)}
                    disabled={pending}
                  >
                    Save
                  </Button>
                </div>
              </li>
            ) : (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate">{row.label}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {row.dkim_selector}@{row.dkim_domain}
                    {row.envelope_domain ? ` · ${row.envelope_domain}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => beginEdit(row)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(row.id)}
                    disabled={pending}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            )
          )}
        </ul>
      )}

      <div className="space-y-2 rounded-control border border-dashed p-2">
        <p className="text-xs font-medium text-muted-foreground">
          Add a sender
        </p>
        <SenderFields values={adding} onChange={setAdding} />
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={add}
            disabled={
              pending ||
              adding.label.trim() === "" ||
              adding.dkim_selector.trim() === "" ||
              adding.dkim_domain.trim() === ""
            }
          >
            {pending ? "Saving…" : "Add sender"}
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function SenderFields({
  values,
  onChange,
}: {
  values: KnownSenderFields;
  onChange: (next: KnownSenderFields) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <input
        value={values.label}
        onChange={(event) => onChange({ ...values, label: event.target.value })}
        placeholder="Label (e.g. Google Workspace)"
        aria-label="Label"
        className={fieldInputClass}
      />
      <input
        value={values.dkim_selector}
        onChange={(event) =>
          onChange({ ...values, dkim_selector: event.target.value })
        }
        placeholder="DKIM selector (e.g. google)"
        aria-label="DKIM selector"
        className={`${fieldInputClass} font-mono`}
      />
      <input
        value={values.dkim_domain}
        onChange={(event) =>
          onChange({ ...values, dkim_domain: event.target.value })
        }
        placeholder="DKIM domain"
        aria-label="DKIM domain"
        className={`${fieldInputClass} font-mono`}
      />
      <input
        value={values.envelope_domain}
        onChange={(event) =>
          onChange({ ...values, envelope_domain: event.target.value })
        }
        placeholder="Envelope domain (optional)"
        aria-label="Envelope domain"
        className={`${fieldInputClass} font-mono`}
      />
    </div>
  );
}
