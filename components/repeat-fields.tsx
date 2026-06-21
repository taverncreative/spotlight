"use client";

import { useState } from "react";
import { fieldInputClass } from "@/components/form-field";
import { RECURRENCE_FREQUENCIES } from "@/lib/jobs/recurrence";

// The repeat-rule fields, shared by the create form (under a "Repeats" toggle)
// and the edit form (under the scope selector). The field names match the
// recurrence schemas (frequency, interval, end_kind, until_date,
// occurrence_count); the end inputs reveal by the chosen end kind. Self-contained
// client state for the end-kind radio; the values still submit by their names.

const FREQUENCY_LABELS: Record<string, string> = {
  daily: "Day",
  weekly: "Week",
  monthly: "Month",
  yearly: "Year",
};

export type RepeatInitial = {
  frequency?: string;
  interval?: number;
  end_kind?: string;
  until_date?: string | null;
  occurrence_count?: number | null;
};

export function RepeatFields({
  initial = {},
  errors,
}: {
  initial?: RepeatInitial;
  errors?: {
    until_date?: string[];
    occurrence_count?: string[];
    interval?: string[];
  };
}) {
  const [endKind, setEndKind] = useState(initial.end_kind ?? "never");

  return (
    <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="frequency" className="text-sm font-medium">
            Frequency
          </label>
          <select
            id="frequency"
            name="frequency"
            defaultValue={initial.frequency ?? "weekly"}
            className={fieldInputClass}
          >
            {RECURRENCE_FREQUENCIES.map((value) => (
              <option key={value} value={value}>
                {FREQUENCY_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="interval" className="text-sm font-medium">
            Every (N)
          </label>
          <input
            id="interval"
            name="interval"
            type="number"
            min={1}
            defaultValue={initial.interval ?? 1}
            className={fieldInputClass}
          />
          {errors?.interval ? (
            <p className="text-xs text-destructive">{errors.interval[0]}</p>
          ) : null}
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Ends</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="end_kind"
            value="never"
            checked={endKind === "never"}
            onChange={() => setEndKind("never")}
          />
          Never
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="end_kind"
              value="on"
              checked={endKind === "on"}
              onChange={() => setEndKind("on")}
            />
            On date
          </label>
          <input
            id="until_date"
            name="until_date"
            type="date"
            aria-label="End date"
            defaultValue={initial.until_date ?? ""}
            disabled={endKind !== "on"}
            className={`${fieldInputClass} max-w-44`}
          />
        </div>
        {errors?.until_date ? (
          <p className="text-xs text-destructive">{errors.until_date[0]}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="end_kind"
              value="after"
              checked={endKind === "after"}
              onChange={() => setEndKind("after")}
            />
            After
          </label>
          <input
            id="occurrence_count"
            name="occurrence_count"
            type="number"
            min={1}
            aria-label="Occurrences"
            defaultValue={initial.occurrence_count ?? ""}
            disabled={endKind !== "after"}
            className={`${fieldInputClass} max-w-28`}
          />
          <span className="text-sm text-muted-foreground">times</span>
        </div>
        {errors?.occurrence_count ? (
          <p className="text-xs text-destructive">{errors.occurrence_count[0]}</p>
        ) : null}
      </fieldset>
    </div>
  );
}
