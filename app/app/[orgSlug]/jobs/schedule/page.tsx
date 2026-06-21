import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { FilterPill } from "@/components/filter-pill";
import { ListScreen } from "@/components/list-screen";
import { JobsViewToggle } from "@/components/jobs-view-toggle";
import { JobWeekCard, type WeekJob } from "@/components/job-week-card";
import { AuthorisationError, hasPermission } from "@/lib/authorisation";
import { JOB_STATUSES } from "@/lib/jobs/schemas";
import { STATUS_DOT, STATUS_LABELS } from "@/lib/jobs/status";
import {
  addWeeksUTC,
  dayIndexInWeek,
  formatDayHeading,
  formatWeekRange,
  isSameUTCDay,
  startOfWeekUTC,
  weekDayStarts,
  weekParam,
  weekStartFromParam,
} from "@/lib/jobs/week";
import { listOrganisationMembers } from "@/lib/members";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { cn } from "@/lib/utils";
import { listScheduledJobs, countUnscheduledJobs } from "../actions";

type Member = { id: string; name: string };

export default async function JobsSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ week?: string; assignee?: string }>;
}) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const { user, membership } = await requireWorkspaceAccess(orgSlug);
  const canWrite = hasPermission(membership, "record.write");

  // The week is computed in UTC, matching how scheduled_start is stored and
  // shown. "now" anchors the default week and the today highlight.
  const now = new Date();
  const weekStart = weekStartFromParam(sp.week, now);
  const days = weekDayStarts(weekStart);
  const from = weekStart.toISOString();
  const to = addWeeksUTC(weekStart, 1).toISOString();
  const isCurrentWeek = isSameUTCDay(weekStart, startOfWeekUTC(now));

  let jobs: WeekJob[];
  let members: Member[];
  let unscheduledCount: number;
  let activeAssignee: string | undefined;
  try {
    members = await listOrganisationMembers(orgSlug);
    activeAssignee =
      sp.assignee === "me" || members.some((m) => m.id === sp.assignee)
        ? sp.assignee
        : undefined;

    const range: Record<string, unknown> = { from, to };
    if (activeAssignee === "me") range.assigned_to = user.id;
    else if (activeAssignee) range.assigned_to = activeAssignee;

    [jobs, unscheduledCount] = await Promise.all([
      listScheduledJobs(orgSlug, range) as unknown as Promise<WeekJob[]>,
      countUnscheduledJobs(orgSlug),
    ]);
  } catch (error) {
    // No jobs entitlement: send the member back to the workspace overview
    // rather than showing a broken screen. Anything else is a real error.
    if (error instanceof AuthorisationError) {
      redirect(`/app/${orgSlug}`);
    }
    throw error;
  }

  const nameById = new Map(members.map((m) => [m.id, m.name]));

  // Bucket each scheduled job into its day column (the query already restricts
  // to this week, so every job lands in one of the seven).
  const byDay: WeekJob[][] = days.map(() => []);
  for (const job of jobs) {
    if (!job.scheduled_start) continue;
    const idx = dayIndexInWeek(weekStart, new Date(job.scheduled_start));
    if (idx !== -1) byDay[idx].push(job);
  }

  const baseHref = `/app/${orgSlug}/jobs/schedule`;
  const hrefFor = (
    weekValue: string | undefined,
    assignee: string | undefined
  ) => {
    const query = new URLSearchParams();
    if (weekValue) query.set("week", weekValue);
    if (assignee) query.set("assignee", assignee);
    const qs = query.toString();
    return qs ? `${baseHref}?${qs}` : baseHref;
  };

  // Assignee links keep the displayed week; the week controls keep the assignee.
  const displayedWeek = weekParam(weekStart);
  const prevHref = hrefFor(weekParam(addWeeksUTC(weekStart, -1)), activeAssignee);
  const nextHref = hrefFor(weekParam(addWeeksUTC(weekStart, 1)), activeAssignee);
  const thisWeekHref = hrefFor(undefined, activeAssignee);

  return (
    <ListScreen
      title="Jobs"
      description="Week view of scheduled work."
      action={
        canWrite ? (
          <Link
            href={`/app/${orgSlug}/jobs/new`}
            className={buttonVariants({ size: "sm" })}
          >
            New job
          </Link>
        ) : null
      }
      toolbarEnd={<JobsViewToggle orgSlug={orgSlug} active="week" />}
      filters={
        <nav aria-label="Filter by assignee" className="flex flex-wrap gap-1">
          <FilterPill
            href={hrefFor(displayedWeek, undefined)}
            label="All assignees"
            active={!activeAssignee}
          />
          <FilterPill
            href={hrefFor(displayedWeek, "me")}
            label="Me"
            active={activeAssignee === "me"}
          />
          {members.map((member) => (
            <FilterPill
              key={member.id}
              href={hrefFor(displayedWeek, member.id)}
              label={member.name}
              active={activeAssignee === member.id}
            />
          ))}
        </nav>
      }
    >
      {/* Week navigation and the unscheduled rail. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href={prevHref}
            aria-label="Previous week"
            className={buttonVariants({ variant: "outline", size: "icon" })}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Link>
          <Link
            href={thisWeekHref}
            aria-current={isCurrentWeek ? "true" : undefined}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            This week
          </Link>
          <Link
            href={nextHref}
            aria-label="Next week"
            className={buttonVariants({ variant: "outline", size: "icon" })}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
          <h2 className="ml-1 text-sm font-medium" aria-live="polite">
            {formatWeekRange(weekStart)}
          </h2>
        </div>

        {unscheduledCount > 0 ? (
          <Link
            href={`/app/${orgSlug}/jobs?status=unscheduled`}
            className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground shadow-soft transition-colors hover:bg-accent hover:text-foreground"
          >
            {unscheduledCount} unscheduled{" "}
            {unscheduledCount === 1 ? "job" : "jobs"} &rarr;
          </Link>
        ) : null}
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No jobs scheduled for this week.
        </p>
      ) : null}

      {/* The week grid: one column per day, Mon to Sun, in UTC. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {days.map((day, i) => {
          const heading = formatDayHeading(day);
          const today = isSameUTCDay(day, now);
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "flex min-h-32 flex-col rounded-lg border bg-muted/30 p-2",
                today && "border-brand/60 ring-1 ring-brand/30"
              )}
            >
              <div className="mb-2 flex items-baseline justify-between px-0.5">
                <span
                  className={cn(
                    "text-xs font-medium",
                    today ? "text-brand" : "text-foreground"
                  )}
                >
                  {heading.weekday}
                </span>
                <span className="text-xs text-muted-foreground">
                  {heading.date}
                </span>
              </div>
              <div className="flex-1 space-y-1.5">
                {byDay[i].map((job) => (
                  <JobWeekCard
                    key={job.id}
                    orgSlug={orgSlug}
                    job={job}
                    assigneeName={
                      job.assigned_to
                        ? nameById.get(job.assigned_to) ?? "Unknown"
                        : null
                    }
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Status legend, so the dot colours are decodable. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        {JOB_STATUSES.map((status) => (
          <span key={status} className="inline-flex items-center gap-1.5">
            <span
              className={cn("size-2 rounded-full", STATUS_DOT[status])}
              aria-hidden="true"
            />
            {STATUS_LABELS[status]}
          </span>
        ))}
      </div>
    </ListScreen>
  );
}
