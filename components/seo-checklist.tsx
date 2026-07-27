"use client";

import { Check, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  IMPORTANCE_LABELS,
  IMPORTANCE_ORDER,
  seoScore,
  type SeoInput,
} from "@/lib/posts/seo-score";

// The SEO checklist panel, grouped by how much each check matters.
//
// Grouped rather than one flat list because the checks are not equal: a missing
// meta description and a missing image alt are both failures, and treating them
// the same trains you to ignore the list. The groups say which to fix first.
//
// The scoring itself lives in lib/posts/seo-score.ts as a pure function, so this
// component only decides how to draw the result. That split is why the rules
// have tests and this does not need them.
export function SeoChecklist({ input }: { input: SeoInput }) {
  const result = seoScore(input);

  // No focus keyword: nothing to check against, so the panel asks for one rather
  // than showing twelve failures for a post that has done nothing wrong.
  if (result.score === null) {
    return (
      <div className="rounded-card border border-dashed bg-card/50 p-4">
        <p className="text-sm font-medium">SEO checklist</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Set a focus keyword above and this scores the post against it.
        </p>
      </div>
    );
  }

  const percent = Math.round(result.score * 100);
  // Same warm ramp as everywhere else, with the counter green for a good score.
  const tone =
    percent >= 80
      ? "text-counter-ok"
      : percent >= 50
        ? "text-status-warn"
        : "text-status-danger";

  return (
    <div className="space-y-3 rounded-card border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">SEO checklist</p>
        <p className="text-xs text-muted-foreground">
          <span className={cn("font-medium tabular-nums", tone)}>
            {percent}%
          </span>{" "}
          · {result.passed} of {result.total}
        </p>
      </div>

      {IMPORTANCE_ORDER.map((importance) => {
        const group = result.checks.filter(
          (check) => check.importance === importance
        );
        if (group.length === 0) return null;
        const failed = group.filter((check) => !check.passed).length;

        return (
          <section key={importance} className="space-y-1">
            <h3 className="flex items-baseline justify-between gap-2 text-xs font-medium text-muted-foreground">
              {IMPORTANCE_LABELS[importance]}
              {failed > 0 ? (
                <span className="tabular-nums">{failed} to fix</span>
              ) : null}
            </h3>
            <ul className="space-y-1">
              {group.map((check) => (
                <li key={check.id} className="flex items-baseline gap-2">
                  {check.passed ? (
                    <Check
                      aria-hidden="true"
                      className="mt-0.5 size-3.5 shrink-0 text-counter-ok"
                    />
                  ) : importance === "polish" ? (
                    <Minus
                      aria-hidden="true"
                      className="mt-0.5 size-3.5 shrink-0 text-status-warn"
                    />
                  ) : (
                    <X
                      aria-hidden="true"
                      className="mt-0.5 size-3.5 shrink-0 text-status-danger"
                    />
                  )}
                  <span className="min-w-0 flex-1 text-xs">
                    <span
                      className={
                        check.passed ? "text-muted-foreground" : undefined
                      }
                    >
                      {check.label}
                    </span>
                    {check.detail ? (
                      <span className="ml-1.5 text-muted-foreground">
                        — {check.detail}
                      </span>
                    ) : null}
                    <span className="sr-only">
                      {check.passed ? " passed" : " not done"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
