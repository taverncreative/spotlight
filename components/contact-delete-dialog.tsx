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

// Contacts hard-delete, so the delete is behind a confirm step that makes
// clear it is permanent (unlike the soft-delete of the bigger records).
export function ContactDeleteDialog({
  action,
  contactName,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  contactName: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <div className="space-y-1">
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
            <AlertDialogTitle>Delete this contact?</AlertDialogTitle>
            <AlertDialogDescription>
              {contactName} will be permanently removed. Contacts are not
              recoverable, so this cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <form action={formAction}>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Deleting" : "Delete contact"}
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
