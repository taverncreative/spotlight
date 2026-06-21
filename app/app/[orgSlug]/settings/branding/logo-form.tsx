"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/form-field";
import { cn } from "@/lib/utils";
import type { LogoFormState } from "./actions";

// The logo control: shows the current logo (if any), a file input that accepts
// PNG or JPEG, an Upload button and, when a logo is set, a Remove button. The
// image is posted to the action, which validates its real content and stores it;
// this client only does a friendly type/size hint. On save the shell, the public
// quote page and the PDF all pick up the new logo.
export function LogoForm({
  action,
  currentLogoUrl,
}: {
  action: (state: LogoFormState, formData: FormData) => Promise<LogoFormState>;
  currentLogoUrl: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [chosenName, setChosenName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const hasLogo = currentLogoUrl.trim() !== "";

  return (
    <form action={formAction} aria-label="Workspace logo" className="space-y-4">
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
          {state.cleared
            ? "Logo removed. The workspace shows its initial again."
            : "Logo saved. It now appears across the workspace and on your quotes."}
        </p>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Current logo
        </p>
        <div className="flex items-center gap-4 rounded-lg bg-muted/40 p-4">
          {hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentLogoUrl}
              alt="Current workspace logo"
              className="max-h-12 w-auto max-w-[200px] object-contain"
            />
          ) : (
            <span className="text-sm text-muted-foreground">
              No logo set. The workspace shows its initial.
            </span>
          )}
        </div>
      </div>

      <FormField label="Logo image" name="logo" errors={state?.fieldErrors?.logo}>
        <input
          ref={fileRef}
          id="logo"
          name="logo"
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          onChange={(event) =>
            setChosenName(event.target.files?.[0]?.name ?? "")
          }
          className={cn(
            "block w-full text-sm text-muted-foreground",
            "file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted"
          )}
        />
      </FormField>
      <p className="-mt-2 text-xs text-muted-foreground">
        PNG or JPEG, up to 2 MB.
      </p>

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" disabled={pending || chosenName === ""}>
          {pending ? "Saving" : "Upload logo"}
        </Button>
        {hasLogo ? (
          <Button
            type="submit"
            name="intent"
            value="clear"
            variant="outline"
            disabled={pending}
          >
            Remove logo
          </Button>
        ) : null}
      </div>
    </form>
  );
}
