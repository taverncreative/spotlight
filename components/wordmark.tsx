import { cn } from "@/lib/utils";

// The Spotlight wordmark (Design Pass 1): a small brand-coloured mark beside the
// product name. The mark is one of the few places the accent is used, so it
// re-themes with the brand colour. Used on the login screen and in the app
// shell header.
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
        S
      </span>
      <span className={cn("font-medium tracking-tight", textClassName)}>
        Spotlight
      </span>
    </span>
  );
}
