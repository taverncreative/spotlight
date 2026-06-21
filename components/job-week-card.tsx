import Link from "next/link";
import { Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatScheduledTime } from "@/lib/jobs/week";
import { statusDot, statusLabel } from "@/lib/jobs/status";

// A compact job card in the scheduler week grid: the start time and a status
// dot on top, then the job title, the customer and the assignee. A recurring
// occurrence carries a small repeat icon. The whole card links to the job's
// detail. Times are formatted at UTC, the stored convention (see
// lib/jobs/week.ts). Server-rendered.
export type WeekJob = {
  id: string;
  title: string;
  status: string;
  scheduled_start: string | null;
  assigned_to: string | null;
  series_id: string | null;
  customers: { name: string } | null;
};

export function JobWeekCard({
  orgSlug,
  job,
  assigneeName,
}: {
  orgSlug: string;
  job: WeekJob;
  assigneeName: string | null;
}) {
  return (
    <Link
      href={`/app/${orgSlug}/jobs/${job.id}`}
      className="block space-y-1 rounded-md border bg-card p-2 text-left shadow-soft transition-colors hover:bg-accent"
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="flex items-center gap-1 text-xs font-medium tabular-nums">
          {job.scheduled_start ? formatScheduledTime(job.scheduled_start) : ""}
          {job.series_id ? (
            <Repeat
              className="size-3 text-muted-foreground"
              aria-label="Recurring"
            />
          ) : null}
        </span>
        <span
          className={cn("size-2 shrink-0 rounded-full", statusDot(job.status))}
          title={statusLabel(job.status)}
          aria-hidden="true"
        />
        <span className="sr-only">{statusLabel(job.status)}</span>
      </div>
      <p className="line-clamp-2 text-sm font-medium leading-snug">{job.title}</p>
      <p className="truncate text-xs text-muted-foreground">
        {job.customers?.name ?? "Unknown customer"}
      </p>
      <p className="truncate text-xs text-muted-foreground">
        {assigneeName ?? "Unassigned"}
      </p>
    </Link>
  );
}
