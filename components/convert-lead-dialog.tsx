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

// Convert with a confirmation step. On confirm the bound form action runs
// the atomic conversion and redirects to the new customer. Errors and the
// already-converted message show beneath the trigger.
export function ConvertLeadDialog({
  action,
  leadName,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  leadName: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <div className="space-y-2">
      <AlertDialog>
        <AlertDialogTrigger
          render={<Button size="sm">Convert to customer</Button>}
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Convert this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates a customer from {leadName}&apos;s details (name,
              email and phone) and marks the lead as converted. You will be
              taken to the new customer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <form action={formAction}>
              <Button type="submit" disabled={pending}>
                {pending ? "Converting" : "Convert lead"}
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
