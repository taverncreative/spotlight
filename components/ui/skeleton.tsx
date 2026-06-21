import { cn } from "@/lib/utils";

// A calm pulsing placeholder for loading states (used by the route loading.tsx
// files). It uses the muted surface so it sits quietly in both themes.
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
    />
  );
}
