import { cn } from "@/lib/utils";

// The Spotlight mark: three concentric circles reading as focus narrowing to a
// point. Outer ring faint, middle ring stronger, centre solid.
//
// Inline SVG rather than a raster file, for three reasons that all matter here:
// it stays sharp at any size, it costs no extra request, and every stroke is
// currentColor, so the mark re-themes with --brand between light and dark
// instead of shipping two files and picking one.
//
// Geometry is on a 24-unit grid: rings at r=9 and r=5.5 with a 2-unit stroke,
// and a 2.5-unit filled centre. The gaps between them are close to even, which
// is what makes it read as narrowing rather than as three unrelated circles.
export function SpotlightMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("size-full", className)}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.4"
      />
      <circle
        cx="12"
        cy="12"
        r="5.5"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.7"
      />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    </svg>
  );
}

// The mark on its tile, which is how it appears in the header and on login.
//
// The tile is a brand tint rather than solid brand: the mark's own three
// opacities are the point, and they are lost against a saturated fill. Corner
// radius is a fifth of the width (rounded-[0.35rem] on a 1.75rem tile), the
// squircle-ish proportion that reads as a product mark rather than a button.
export function SpotlightLogo({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-[0.35rem] bg-brand/10 text-brand",
        className
      )}
    >
      <SpotlightMark className={cn("size-5", markClassName)} />
    </span>
  );
}
