import { cn } from "@/lib/utils";
import type { SocialStatus } from "@/lib/social/schemas";

// Status pill for social posts — reuses the rounded chip shape used across the
// app (MonitoringChip), with a colour per lifecycle state.
const STATUS: Record<SocialStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  scheduled: {
    label: "Scheduled",
    className: "bg-status-info-surface text-status-info",
  },
  publishing: {
    label: "Publishing",
    className: "bg-status-warn-surface text-status-warn",
  },
  published: {
    label: "Published",
    className: "bg-status-ok-surface text-status-ok",
  },
  partial: {
    label: "Partial",
    className: "bg-status-warn-surface text-status-warn",
  },
  failed: {
    label: "Failed",
    className: "bg-status-danger-surface text-status-danger",
  },
};

export function SocialStatusPill({ status }: { status: string }) {
  const s = STATUS[status as SocialStatus] ?? STATUS.draft;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium",
        s.className
      )}
    >
      {s.label}
    </span>
  );
}
