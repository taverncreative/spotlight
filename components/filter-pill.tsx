import Link from "next/link";
import { cn } from "@/lib/utils";

// Server-rendered filter pill used by the module list screens (leads
// status, customers type). The active filter is part of the URL.
export function FilterPill({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors",
        active
          ? "border-border bg-card font-medium text-foreground shadow-soft"
          : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {label}
    </Link>
  );
}
