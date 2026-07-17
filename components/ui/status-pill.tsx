import { cn } from "@/lib/utils";

// Shared lifecycle status chip, used by every module that shows post state (the
// blog list and the social card grid today). It owns the rounded-pill shape and
// the warm-bento status tokens so the modules read as one visual language
// instead of each inventing its own chip.
//
// The map is the union of the module lifecycles: blog uses draft|published,
// social uses all six, and the requests inbox uses new|in_progress|done.
// Callers pass a plain status string (the list queries type it as string), and
// an unknown value falls back to the neutral draft styling rather than throwing
// on a status a module adds later.

type StatusTone = "muted" | "info" | "warn" | "ok" | "danger";

const TONE: Record<StatusTone, string> = {
  muted: "bg-muted text-muted-foreground",
  info: "bg-status-info-surface text-status-info",
  warn: "bg-status-warn-surface text-status-warn",
  ok: "bg-status-ok-surface text-status-ok",
  danger: "bg-status-danger-surface text-status-danger",
};

type Status =
  | "draft"
  | "scheduled"
  | "publishing"
  | "published"
  | "partial"
  | "failed"
  | "new"
  | "in_progress"
  | "done";

const STATUS: Record<Status, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "muted" },
  scheduled: { label: "Scheduled", tone: "info" },
  publishing: { label: "Publishing", tone: "warn" },
  published: { label: "Published", tone: "ok" },
  partial: { label: "Partial", tone: "warn" },
  failed: { label: "Failed", tone: "danger" },
  // The requests inbox. Tones echo the publish lifecycle deliberately: untouched
  // reads as info, in-flight as warn, finished as ok, so a status chip means the
  // same thing wherever it appears.
  new: { label: "New", tone: "info" },
  in_progress: { label: "In progress", tone: "warn" },
  done: { label: "Done", tone: "ok" },
};

export function StatusPill({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const s = STATUS[status as Status] ?? STATUS.draft;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-1.5 py-0.5 text-xs font-medium",
        TONE[s.tone],
        className
      )}
    >
      {s.label}
    </span>
  );
}
