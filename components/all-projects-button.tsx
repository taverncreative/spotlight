"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// The "All projects" toggle: routes to the cross-client home board. Sits beside
// the client selector in both the home and per-client headers, so the operator
// can move all <-> one from anywhere. Terracotta primary when on the home board,
// derived from the URL (no selected-client prop needed).
export function AllProjectsButton() {
  const active = usePathname() === "/home";
  return (
    <Link
      href="/home"
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-control border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-input hover:bg-accent"
      )}
    >
      All projects
    </Link>
  );
}
