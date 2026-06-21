"use client";

import { useActionState } from "react";
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

// Create a job from a quote, behind a confirmation step. On confirm the bound
// action pre-fills a job from the quote (customer, site and a sensible title),
// links it back to the quote and takes the user to the new job, in the spirit of
// lead-to-customer conversion.
export function CreateJobFromQuoteDialog({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <div className="space-y-1">
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button variant="outline" size="sm">
              Create job
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create a job from this quote?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates an unscheduled job for the same customer and site,
              linked back to this quote. You will be taken to the new job to
              schedule it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <form action={formAction}>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating" : "Create job"}
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
