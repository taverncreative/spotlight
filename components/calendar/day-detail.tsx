"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

// The interactive island in an otherwise server-rendered calendar.
//
// It owns open state and nothing else: the day's contents arrive as children,
// already rendered on the server, so module-specific actions (cancel, publish,
// delete) keep working without this component knowing what any module is. That
// is what lets one calendar serve blog and social.
export function DayDetail({
  title,
  trigger,
  triggerClassName,
  triggerLabel,
  children,
}: {
  title: string;
  trigger: ReactNode;
  triggerClassName?: string;
  // Spoken label, because the visible trigger is often just a number.
  triggerLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={triggerLabel}
        className={cn(
          "cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
          triggerClassName
        )}
      >
        {trigger}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
          <DialogTitle>{title}</DialogTitle>
          {children}
        </DialogContent>
      </Dialog>
    </>
  );
}
