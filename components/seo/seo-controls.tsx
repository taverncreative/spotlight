"use client";

import { useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { fieldInputClass } from "@/components/form-field";
import { SEO_RANGES } from "@/lib/gsc/ranges";

// Header controls: a property selector (only when the client has more than one
// mapped property) and the date-range selector. Both update the URL search
// params so the server page re-fetches.
export function SeoControls({
  properties,
  selected,
  rangeKey,
}: {
  properties: { siteUrl: string; label: string }[];
  selected: string;
  rangeKey: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function go(next: { property?: string; range?: string }) {
    const params = new URLSearchParams();
    params.set("property", next.property ?? selected);
    params.set("range", next.range ?? rangeKey);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {properties.length > 1 ? (
        <select
          aria-label="Search Console property"
          value={selected}
          onChange={(event) => go({ property: event.target.value })}
          className={cn(fieldInputClass, "h-8 w-auto max-w-[16rem] py-1 text-xs")}
        >
          {properties.map((property) => (
            <option key={property.siteUrl} value={property.siteUrl}>
              {property.siteUrl}
            </option>
          ))}
        </select>
      ) : null}

      <div className="inline-flex rounded-md border p-0.5">
        {SEO_RANGES.map((range) => (
          <button
            key={range.key}
            type="button"
            onClick={() => go({ range: range.key })}
            aria-pressed={range.key === rangeKey}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium transition-colors",
              range.key === rangeKey
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {range.label}
          </button>
        ))}
      </div>
    </div>
  );
}
