import { cn } from "@/lib/utils";

// The BSK View wordmark (Design Pass 1): a small brand-coloured mark beside the
// product name. The mark is one of the few places the accent is used, so it
// re-themes with the workspace brand colour. Used on the login screen and as
// the "Powered by BSK View" mark in the app shell.
export function Wordmark({
  className,
  textClassName,
}: {
  className?: string;
  textClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-md bg-brand text-[0.7rem] font-medium text-brand-foreground"
      >
        B
      </span>
      <span className={cn("font-medium tracking-tight", textClassName)}>
        BSK View
      </span>
    </span>
  );
}
