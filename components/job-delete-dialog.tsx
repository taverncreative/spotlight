"use client";

import { useActionState, useState } from "react";
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

// Jobs hard-delete (there is no soft-delete or restore), so the delete sits
// behind a confirm step that makes clear it is permanent, the same pattern as
// tasks and contacts. To record that a job did not happen without losing it,
// cancel it instead.
//
// When the job belongs to a series, the confirm offers the classic three-way
// scope (this occurrence / this and following / the entire series). A one-off
// keeps the simple single confirm; the action defaults to the occurrence scope.
export function JobDeleteDialog({
  action,
  jobTitle,
  series = false,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  jobTitle: string;
  series?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [scope, setScope] = useState<"occurrence" | "following" | "series">(
    "occurrence"
  );

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
            <AlertDialogTitle>
              {series ? "Delete recurring job?" : "Delete this job?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {jobTitle} will be permanently removed. Jobs are not recoverable,
              so this cannot be undone. To record that a job did not happen,
              cancel it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form action={formAction}>
            {series ? (
              <fieldset className="space-y-2 py-2">
                <legend className="sr-only">Delete scope</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="scope"
                    value="occurrence"
                    checked={scope === "occurrence"}
                    onChange={() => setScope("occurrence")}
                  />
                  This occurrence only
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="scope"
                    value="following"
                    checked={scope === "following"}
                    onChange={() => setScope("following")}
                  />
                  This and all following
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="scope"
                    value="series"
                    checked={scope === "series"}
                    onChange={() => setScope("series")}
                  />
                  The entire series
                </label>
              </fieldset>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Deleting" : "Delete job"}
              </Button>
            </AlertDialogFooter>
          </form>
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
