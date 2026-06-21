import type { SeriesRow } from "@/lib/jobs/series";
import { describeRule, type Frequency } from "@/lib/jobs/recurrence";

// Pure display helpers mapping a stored job_series row to the form's repeat-rule
// initial values and to a plain-language summary. Kept separate from the
// server-only generation module (lib/jobs/series.ts) so the form components and
// the detail page can use them; the SeriesRow import here is type-only, so it
// pulls in no server-only runtime.

const DAY_MS = 86_400_000;

// The repeat-rule initial values a stored series presents to the edit form
// (frequency, interval, and the end choice with its date or count).
export function seriesRuleInitial(series: SeriesRow): {
  frequency: string;
  interval: number;
  end_kind: "never" | "on" | "after";
  until_date: string | null;
  occurrence_count: number | null;
} {
  if (series.max_occurrences != null) {
    return {
      frequency: series.frequency,
      interval: series.repeat_interval,
      end_kind: "after",
      until_date: null,
      occurrence_count: series.max_occurrences,
    };
  }
  if (series.repeat_until) {
    // The stored bound is exclusive (the day after the last occurrence's date),
    // so the inclusive end date shown is the day before it.
    const inclusive = new Date(new Date(series.repeat_until).getTime() - DAY_MS);
    return {
      frequency: series.frequency,
      interval: series.repeat_interval,
      end_kind: "on",
      until_date: inclusive.toISOString().slice(0, 10),
      occurrence_count: null,
    };
  }
  return {
    frequency: series.frequency,
    interval: series.repeat_interval,
    end_kind: "never",
    until_date: null,
    occurrence_count: null,
  };
}

// A plain-language summary of a stored series rule, for the detail page.
export function describeSeries(series: SeriesRow): string {
  return describeRule({
    frequency: series.frequency as Frequency,
    interval: series.repeat_interval,
    anchor: new Date(series.anchor_start),
    until: series.repeat_until ? new Date(series.repeat_until) : null,
    count: series.max_occurrences,
  });
}
