import { Skeleton } from "@/components/ui/skeleton";

// Loading placeholder for the quote detail (and the builder, its child route),
// mirroring the record-detail shell.
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Skeleton className="h-4 w-28" />
      <div className="space-y-5 rounded-xl border bg-card p-6 shadow-soft">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-8 w-40" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
      <div className="space-y-3 rounded-xl border bg-card p-5 shadow-soft">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
