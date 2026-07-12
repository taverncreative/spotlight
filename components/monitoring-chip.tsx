import { cn } from "@/lib/utils";
import type { ChipTone } from "@/lib/sites/monitoring";

// Shared status chip for the Sites tab, the monitoring board and the per-client
// Overview. Tones and markup moved here verbatim so all three stay identical.
const TONE_CLASS: Record<ChipTone, string> = {
  ok: "bg-status-ok-surface text-status-ok",
  warn: "bg-status-warn-surface text-status-warn",
  danger: "bg-status-danger-surface text-status-danger",
  muted: "bg-muted text-muted-foreground",
};

export function MonitoringChip({
  tone,
  children,
}: {
  tone: ChipTone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-1.5 py-0.5 text-xs font-medium",
        TONE_CLASS[tone]
      )}
    >
      {children}
    </span>
  );
}
