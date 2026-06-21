"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { formatPence } from "@/lib/currency";
import type { LineItem } from "@/components/line-item-row";
import type { FormState } from "@/lib/form-state";

// A saved line at rest: plain read-only values. Its existence in this form
// is the visible confirmation that the line is saved. Edit switches only
// this row into the form via the editLine search param.
export function LineItemDisplay({
  line,
  editHref,
  removeAction,
}: {
  line: LineItem;
  editHref: string;
  removeAction: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [removeState, removeFormAction, removePending] = useActionState(
    removeAction,
    null
  );

  return (
    <div
      data-testid={`line-display-${line.position}`}
      className="space-y-1 rounded-lg bg-muted/40 p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-1 text-sm sm:grid-cols-5 sm:gap-2">
          <p className="break-words font-medium sm:col-span-2">
            {line.description}
          </p>
          <p className="tabular-nums text-muted-foreground">
            {Number(line.quantity).toFixed(2)} ×{" "}
            {formatPence(line.unit_price_pence)}
          </p>
          <p className="tabular-nums text-muted-foreground">
            VAT {Number(line.vat_rate)}%
          </p>
          <p className="font-medium tabular-nums sm:text-right">
            {formatPence(line.line_total_pence)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={editHref}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Edit
          </Link>
          <form action={removeFormAction}>
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={removePending}
            >
              {removePending ? "Removing" : "Remove"}
            </Button>
          </form>
        </div>
      </div>
      {removeState?.formError ? (
        <p role="alert" className="text-sm text-destructive">
          {removeState.formError}
        </p>
      ) : null}
    </div>
  );
}
