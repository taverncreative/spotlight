import { Skeleton } from "@/components/ui/skeleton";

// Loading placeholder for the jobs list, mirroring the list-screen layout
// (header, the two filter rows and the table card) so the swap is calm.
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="space-y-1.5">
        {Array.from({ length: 2 }).map((_, row) => (
          <div key={row} className="flex flex-wrap gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-20 rounded-full" />
            ))}
          </div>
        ))}
      </div>
      <div className="space-y-3 rounded-xl border bg-card p-4 shadow-soft">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
