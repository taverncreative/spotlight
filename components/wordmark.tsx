import { cn } from "@/lib/utils";
import { SpotlightLogo } from "@/components/spotlight-mark";

// The Spotlight wordmark: the mark beside the product name.
//
// The mark used to be a brand-filled square with an "S" in it, which is a
// placeholder rather than a logo. It is now three concentric circles reading as
// focus narrowing to a point, inline so it re-themes with --brand instead of
// shipping a raster per theme (see components/spotlight-mark.tsx).
//
// Used in the app header, where it links home, and on the login screen, where it
// does not.
export function Wordmark({
  className,
  textClassName,
}: {
  className?: string;
  textClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <SpotlightLogo />
      <span className={cn("font-medium tracking-tight", textClassName)}>
        Spotlight
      </span>
    </span>
  );
}
