"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldInputClass } from "@/components/form-field";
import { cn } from "@/lib/utils";
import { setAllocation } from "@/lib/time/actions";
import { type AllocationFormState } from "@/lib/time/schemas";

// Inline per-card allocation editor. Closed, it shows either "Set allocation"
// (unset) or a quiet "Edit" control (set). Open, an hours input (decimal) that
// saves to retainer_minutes, or a Clear that submits empty to null it back to
// "not set". revalidatePath in the action refreshes the board's figures; this
// component only closes the editor on success. The form is mounted only while
// open, so its defaultValue re-reads the latest allocation on each open.

// Integer minutes to a clean hours string: 600 -> "10", 450 -> "7.5".
function minutesToHours(minutes: number): string {
  return (minutes / 60).toFixed(2).replace(/\.?0+$/, "");
}

export function AllocationEditor({
  clientId,
  retainerMinutes,
}: {
  clientId: string;
  retainerMinutes: number | null;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Close on success from the action itself (an event context), not an effect.
  const [state, formAction, pending] = useActionState<
    AllocationFormState,
    FormData
  >(async (previous, formData) => {
    const result = await setAllocation(previous, formData);
    if (result?.ok) setOpen(false);
    return result;
  }, null);

  if (!open) {
    return retainerMinutes === null ? (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Set allocation
      </Button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Edit allocation
      </button>
    );
  }

  const fieldError = state?.fieldErrors?.hours?.[0];

  // Clear empties the input, then submits so the action stores null.
  function clear() {
    const input = inputRef.current;
    if (!input) return;
    input.value = "";
    input.form?.requestSubmit();
  }

  return (
    <form action={formAction} className="space-y-1.5">
      <input type="hidden" name="client_id" value={clientId} />
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          name="hours"
          defaultValue={
            retainerMinutes === null ? "" : minutesToHours(retainerMinutes)
          }
          placeholder="7.5"
          aria-label="Monthly hours"
          autoFocus
          className={cn(fieldInputClass, "h-8 w-16")}
        />
        <span className="text-xs text-muted-foreground">h/mo</span>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancel
        </Button>
        {retainerMinutes === null ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clear}
            disabled={pending}
          >
            Clear
          </Button>
        )}
      </div>
      {fieldError ? (
        <p className="text-xs text-destructive">{fieldError}</p>
      ) : null}
      {state?.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}
    </form>
  );
}
