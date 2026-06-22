"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { CLIENT_MODULES } from "@/lib/modules";

// The Dashoo-style bottom module bar. Tabs link to each module under the active
// client; the active module (read from the route) carries the Azure brand
// accent.
export function ModuleBar({ clientSlug }: { clientSlug: string }) {
  const segments = usePathname().split("/");
  const activeModule = segments[3] || "overview";

  return (
    <nav className="sticky bottom-0 z-40 flex items-center justify-center gap-1 border-t bg-background/95 px-4 py-2 backdrop-blur">
      {CLIENT_MODULES.map((module) => {
        const isActive = module.segment === activeModule;
        return (
          <Link
            key={module.segment}
            href={`/c/${clientSlug}/${module.segment}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-accent text-brand"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {module.label}
          </Link>
        );
      })}
    </nav>
  );
}
