import { Skeleton } from "@/components/ui/skeleton";

// Loading placeholder for the jobs scheduler, mirroring its layout (header, the
// view toggle and assignee row, the week-navigation bar, then the seven day
// columns) so the swap is calm.
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-full" />
          ))}
        </div>
        <Skeleton className="h-7 w-28 rounded-full" />
      </div>
      <Skeleton className="h-8 w-72" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
