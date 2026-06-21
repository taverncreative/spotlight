import { Skeleton } from "@/components/ui/skeleton";

// Loading placeholder for the savings widget, mirroring the layout (header, the
// prominent total card and the items table) so the swap to real content is calm.
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="rounded-xl border bg-card p-6 shadow-soft">
        <Skeleton className="h-4 w-32" />
        <div className="mt-3 flex flex-wrap gap-x-12 gap-y-4">
          <Skeleton className="h-10 w-28" />
          <Skeleton className="h-10 w-28" />
        </div>
      </div>
      <div className="space-y-3 rounded-xl border bg-card p-4 shadow-soft">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
