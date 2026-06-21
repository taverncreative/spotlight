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

// Files hard-delete (the row and the stored object both go, with no restore), so
// the delete sits behind a confirm step that makes clear it is permanent, the
// same pattern as notes, tasks and contacts.
export function FileDeleteDialog({
  action,
  filename,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  filename: string;
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
            <AlertDialogTitle>Delete this file?</AlertDialogTitle>
            <AlertDialogDescription>
              {filename} will be permanently removed, including the stored file.
              Files are not recoverable, so this cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <form action={formAction}>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Deleting" : "Delete file"}
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
