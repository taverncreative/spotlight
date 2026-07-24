"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { fieldInputClass } from "@/components/form-field";
import { addAdjustment } from "@/lib/time/actions";
import { type AdjustmentFormState } from "@/lib/time/schemas";

// Manual add/subtract time for a client, for when a timer was forgotten. Whole
// hours + minutes and a direction become a signed adjust_seconds server-side; the
// date defaults to today and cannot be in the future. Mount under a changing key
// so each open starts fresh. revalidatePath in the action refreshes the board;
// this dialog just closes on success.

// Local calendar date as YYYY-MM-DD, for the date default and its max.
function todayISO(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function AdjustmentDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
}) {
  const [state, formAction, pending] = useActionState<
    AdjustmentFormState,
    FormData
  >(addAdjustment, null);

  const [direction, setDirection] = useState("add");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [date, setDate] = useState(todayISO);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (state?.ok) onOpenChange(false);
  }, [state, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="space-y-1">
          <DialogTitle>Adjust time</DialogTitle>
          <DialogDescription>
            Add or subtract time for {clientName} when a timer was missed.
          </DialogDescription>
        </div>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="client_id" value={clientId} />

          <div className="space-y-1.5">
            <label htmlFor="adj-direction" className="text-sm font-medium">
              Direction
            </label>
            <select
              id="adj-direction"
              name="direction"
              value={direction}
              onChange={(event) => setDirection(event.target.value)}
              className={fieldInputClass}
            >
              <option value="add">Add time</option>
              <option value="subtract">Subtract time</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="adj-hours" className="text-sm font-medium">
                Hours
              </label>
              <input
                id="adj-hours"
                name="hours"
                type="number"
                min={0}
                inputMode="numeric"
                value={hours}
                onChange={(event) => setHours(event.target.value)}
                placeholder="0"
                className={fieldInputClass}
              />
              {state?.fieldErrors?.hours ? (
                <p className="text-sm text-destructive">
                  {state.fieldErrors.hours[0]}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="adj-minutes" className="text-sm font-medium">
                Minutes
              </label>
              <input
                id="adj-minutes"
                name="minutes"
                type="number"
                min={0}
                max={59}
                inputMode="numeric"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
                placeholder="0"
                className={fieldInputClass}
              />
              {state?.fieldErrors?.minutes ? (
                <p className="text-sm text-destructive">
                  {state.fieldErrors.minutes[0]}
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="adj-date" className="text-sm font-medium">
              Date
            </label>
            <input
              id="adj-date"
              name="date"
              type="date"
              max={todayISO()}
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className={fieldInputClass}
            />
            {state?.fieldErrors?.date ? (
              <p className="text-sm text-destructive">
                {state.fieldErrors.date[0]}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="adj-note" className="text-sm font-medium">
              Note <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              id="adj-note"
              name="note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. call not timed"
              className={fieldInputClass}
            />
            {state?.fieldErrors?.note ? (
              <p className="text-sm text-destructive">
                {state.fieldErrors.note[0]}
              </p>
            ) : null}
          </div>

          {state?.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
