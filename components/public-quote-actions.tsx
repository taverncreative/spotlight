"use client";

import { useActionState, type CSSProperties } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/form-state";

// The customer's accept and decline, each behind a simple confirm step.
function ConfirmAction({
  action,
  trigger,
  title,
  description,
  confirmLabel,
  variant = "default",
  brandStyle,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  trigger: string;
  title: string;
  description: string;
  confirmLabel: string;
  variant?: "default" | "outline";
  brandStyle: CSSProperties;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <div className="space-y-2">
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button variant={variant} size="lg">
              {trigger}
            </Button>
          }
        />
        {/* The dialog portals to <body>, outside the page's .q-light scope, so
            it re-establishes the light theme and the brand accent itself. */}
        <AlertDialogContent className="q-light" style={brandStyle}>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <form action={formAction}>
              <Button type="submit" variant={variant} disabled={pending}>
                {pending ? "Working" : confirmLabel}
              </Button>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {state?.formError ? (
        <p role="alert" className="text-sm text-destructive">
          {state.formError}
        </p>
      ) : null}
    </div>
  );
}

export function PublicQuoteActions({
  acceptAction,
  declineAction,
  organisationName,
  canAccept,
  brandColor,
  brandForeground,
}: {
  acceptAction: (state: FormState, formData: FormData) => Promise<FormState>;
  declineAction: (state: FormState, formData: FormData) => Promise<FormState>;
  organisationName: string;
  canAccept: boolean;
  brandColor: string;
  brandForeground: string;
}) {
  const brandStyle = {
    "--brand": brandColor,
    "--brand-foreground": brandForeground,
  } as CSSProperties;

  return (
    <div className="flex flex-wrap gap-3">
      {canAccept ? (
        <ConfirmAction
          action={acceptAction}
          trigger="Accept quote"
          title="Accept this quote?"
          description={`This tells ${organisationName} you accept the quote and the prices shown.`}
          confirmLabel="Accept quote"
          brandStyle={brandStyle}
        />
      ) : null}
      <ConfirmAction
        action={declineAction}
        trigger="Decline"
        title="Decline this quote?"
        description={`This tells ${organisationName} you are declining the quote.`}
        confirmLabel="Decline quote"
        variant="outline"
        brandStyle={brandStyle}
      />
    </div>
  );
}
