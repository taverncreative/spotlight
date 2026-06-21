"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Client = { name: string; slug: string };

// The client selector in the top bar. Shows the active client and drops down the
// operator's clients (server-fetched, RLS-scoped, passed in). Selecting a client
// navigates to the same module under the new client, so switching keeps context.
export function ClientSelector({ clients }: { clients: Client[] }) {
  const [open, setOpen] = useState(false);
  const segments = usePathname().split("/");
  const activeSlug = segments[2] ?? "";
  const currentModule = segments[3] || "overview";
  const active = clients.find((client) => client.slug === activeSlug);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md border border-input px-3 py-1.5 text-sm transition-colors hover:bg-accent"
      >
        <span className="max-w-[12rem] truncate">
          {active?.name ?? "Select client"}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border bg-popover p-1 text-popover-foreground shadow-soft">
          {clients.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              No clients
            </p>
          ) : (
            clients.map((client) => {
              const isActive = client.slug === activeSlug;
              return (
                <Link
                  key={client.slug}
                  href={`/c/${client.slug}/${currentModule}`}
                  className={cn(
                    "flex items-center justify-between rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent",
                    isActive && "text-brand"
                  )}
                >
                  <span className="truncate">{client.name}</span>
                  {isActive ? (
                    <Check className="size-4 shrink-0" aria-hidden="true" />
                  ) : null}
                </Link>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
