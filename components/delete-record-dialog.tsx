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

// Soft delete with a confirmation step, shared by the module detail views
// (leads, customers). The dialog makes clear the record is recoverable; on
// confirm the bound form action soft-deletes and redirects. Errors from the
// action show beneath the trigger.
export function DeleteRecordDialog({
  action,
  entity,
  itemName,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  entity: string;
  itemName: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <div className="space-y-2">
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button variant="destructive" size="sm">
              Delete
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {entity}?</AlertDialogTitle>
            <AlertDialogDescription>
              {itemName} will move to deleted {entity}s. It is not gone for
              good: you can restore it from the deleted {entity}s view at any
              time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <form action={formAction}>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Deleting" : `Delete ${entity}`}
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
