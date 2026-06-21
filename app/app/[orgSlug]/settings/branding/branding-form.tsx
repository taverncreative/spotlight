"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField, fieldInputClass } from "@/components/form-field";
import {
  DEFAULT_BRAND_COLOR,
  brandForegroundColor,
  sanitiseBrandColor,
} from "@/lib/brand";
import { cn } from "@/lib/utils";
import type { BrandingFormState } from "./actions";

// Normalise any accepted hex (3, 6 or 8 digits) to the 6-digit form the native
// colour input requires; falls back to the default for an invalid value so the
// picker always has something to show.
function toPickerHex(value: string): string {
  const sanitised = sanitiseBrandColor(value);
  if (!sanitised) return DEFAULT_BRAND_COLOR;
  let body = sanitised.slice(1);
  if (body.length === 3) {
    body = body
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (body.length === 8) body = body.slice(0, 6);
  return `#${body}`;
}

// The brand colour control: a native colour picker and a hex text input kept in
// step, a live preview of the accent, and save. The current colour is whatever
// the workspace has stored (or the default when none is set). The value is
// validated here for a friendly message and again, authoritatively, in the
// action and at the database.
export function BrandingForm({
  action,
  currentColor,
}: {
  action: (
    state: BrandingFormState,
    formData: FormData
  ) => Promise<BrandingFormState>;
  currentColor: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [color, setColor] = useState(currentColor || DEFAULT_BRAND_COLOR);

  const valid = sanitiseBrandColor(color) !== null;
  const previewColor = valid ? color : DEFAULT_BRAND_COLOR;
  const onPreview = brandForegroundColor(previewColor);
  const fieldError = state?.fieldErrors?.brand_color?.[0];

  return (
    <form action={formAction} aria-label="Branding settings" className="space-y-6">
      {state?.formError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.formError}
        </p>
      ) : null}
      {state?.success ? (
        <p
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
        >
          Brand colour saved. The accent has been updated across the workspace.
        </p>
      ) : null}

      <FormField label="Brand colour" name="brand_color" errors={state?.fieldErrors?.brand_color}>
        <div className="flex items-center gap-3">
          <input
            type="color"
            aria-label="Pick brand colour"
            value={toPickerHex(color)}
            onChange={(event) => setColor(event.target.value)}
            className="size-10 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
          />
          <input
            id="brand_color"
            name="brand_color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!valid && color.trim() !== "" ? true : undefined}
            className={cn(fieldInputClass, "max-w-40 font-mono")}
            placeholder={DEFAULT_BRAND_COLOR}
          />
        </div>
      </FormField>
      {!valid && color.trim() !== "" && !fieldError ? (
        <p className="-mt-3 text-sm text-destructive">
          Enter a valid hex colour, for example {DEFAULT_BRAND_COLOR}.
        </p>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Preview
        </p>
        <div className="flex flex-wrap items-center gap-4 rounded-lg bg-muted/40 p-4">
          <span
            aria-hidden="true"
            className="size-12 rounded-lg border"
            style={{ backgroundColor: previewColor }}
          />
          <span
            className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium"
            style={{ backgroundColor: previewColor, color: onPreview }}
          >
            Primary button
          </span>
          <span
            className="inline-flex items-center rounded-md px-2.5 py-1 text-sm font-medium"
            style={{
              backgroundColor: `color-mix(in oklch, ${previewColor} 12%, transparent)`,
              color: previewColor,
            }}
          >
            Active navigation
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : "Save brand colour"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setColor(DEFAULT_BRAND_COLOR)}
          disabled={pending}
        >
          Reset to default
        </Button>
      </div>
    </form>
  );
}
