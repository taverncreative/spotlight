import { cn } from "@/lib/utils";
import type { SocialStatus } from "@/lib/social/schemas";

// Status pill for social posts — reuses the rounded chip shape used across the
// app (MonitoringChip), with a colour per lifecycle state.
const STATUS: Record<SocialStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  scheduled: { label: "Scheduled", className: "bg-brand/15 text-brand" },
  publishing: {
    label: "Publishing",
    className: "bg-amber-500/15 text-amber-400",
  },
  published: {
    label: "Published",
    className: "bg-emerald-500/15 text-emerald-400",
  },
  partial: { label: "Partial", className: "bg-amber-500/15 text-amber-400" },
  failed: { label: "Failed", className: "bg-destructive/15 text-destructive" },
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
