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

// Draft to sent, behind a confirm step: editing locks and the
// customer-facing issued date stamps now.
export function MarkSentDialog({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <div className="space-y-2">
      <AlertDialog>
        <AlertDialogTrigger render={<Button size="sm">Mark as sent</Button>} />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this quote as sent?</AlertDialogTitle>
            <AlertDialogDescription>
              Editing will lock and the issued date stamps now: this is the date
              the customer sees. You can return the quote to draft if you need
              to change it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <form action={formAction}>
              <Button type="submit" disabled={pending}>
                {pending ? "Marking" : "Mark as sent"}
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
