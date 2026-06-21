import type { JobStatus } from "@/lib/jobs/schemas";

// The single source for how a job status is shown: its label, its list/detail
// Badge variant, and its scheduler dot colour. Pass 1 duplicated the labels and
// badge variants in the list and detail pages; this consolidates them so the
// scheduler view (Pass 2) reuses the same names and the three screens cannot
// drift. The dot colours are fixed, saturated palette values (not theme tokens):
// a small filled circle reads clearly on both the dark and the light canvas, so
// the status stays legible in either theme.

export type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

export const STATUS_LABELS: Record<JobStatus, string> = {
  unscheduled: "Unscheduled",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const STATUS_BADGES: Record<JobStatus, BadgeVariant> = {
  unscheduled: "outline",
  scheduled: "secondary",
  in_progress: "default",
  completed: "secondary",
  cancelled: "destructive",
};

export const STATUS_DOT: Record<JobStatus, string> = {
  unscheduled: "bg-slate-400",
  scheduled: "bg-sky-500",
  in_progress: "bg-amber-500",
  completed: "bg-emerald-500",
  cancelled: "bg-rose-500",
};

// Safe lookups for an unexpected status string coming from the database.
export function statusLabel(status: string): string {
  return STATUS_LABELS[status as JobStatus] ?? status;
}

export function statusBadge(status: string): BadgeVariant {
  return STATUS_BADGES[status as JobStatus] ?? "secondary";
}

export function statusDot(status: string): string {
  return STATUS_DOT[status as JobStatus] ?? "bg-slate-400";
}
