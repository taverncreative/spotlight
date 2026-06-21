import Link from "next/link";
import { cn } from "@/lib/utils";

// A small segmented control switching between the jobs list and the week
// scheduler. Both views live under the jobs module (and its entitlement gate);
// this is just navigation between two sub-routes. Server-rendered, the active
// view styled like the active FilterPill so it matches the design language.
const VIEWS = [
  { key: "list", label: "List", segment: "" },
  { key: "week", label: "Week", segment: "/schedule" },
] as const;

export function JobsViewToggle({
  orgSlug,
  active,
}: {
  orgSlug: string;
  active: "list" | "week";
}) {
  return (
    <div
      role="tablist"
      aria-label="Jobs view"
      className="inline-flex items-center gap-1 rounded-full border bg-card p-0.5 shadow-soft"
    >
      {VIEWS.map((view) => {
        const isActive = view.key === active;
        return (
          <Link
            key={view.key}
            role="tab"
            aria-selected={isActive}
            href={`/app/${orgSlug}/jobs${view.segment}`}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition-colors",
              isActive
                ? "bg-brand/10 font-medium text-brand"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {view.label}
          </Link>
        );
      })}
    </div>
  );
}
