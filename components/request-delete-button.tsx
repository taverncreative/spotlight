"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteRequest } from "@/lib/requests/actions";

// Delete an inbound request. Same shape as PostDeleteButton: the action is
// called inside a transition rather than through a form, so success can close
// the dialog and refresh, and a refusal shows inline instead of leaving the
// dialog open looking broken.
//
// ONLY RENDERED ON UNASSIGNED ROWS, and that is the caller's job as well as the
// database's. RLS (0087) is what actually prevents deleting an assigned request;
// not offering the button is so the operator never presses something that cannot
// work. The action still refuses assigned rows by name, because a button that
// silently does nothing is worse than one that explains itself.
export function RequestDeleteButton({
  requestId,
  summary,
}: {
  requestId: string;
  // The first line of the message, so the dialog names what is about to go
  // rather than asking for trust. This is a request nobody assigned to a client,
  // so there is no client name to identify it by.
  summary: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmDelete() {
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("id", requestId);
        const result = await deleteRequest(null, formData);
        if (result?.ok) {
          setOpen(false);
          router.refresh();
        } else {
          setError(result?.error ?? "Could not delete the request.");
        }
      } catch {
        setError("Could not delete the request.");
      }
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Trash2 />
        Delete
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent size="sm">
          <div className="space-y-2">
            <AlertDialogTitle>Delete this request?</AlertDialogTitle>
            <AlertDialogDescription>
              {summary ? `“${summary}” ` : ""}will be permanently removed. This
              cannot be undone, and the sending app is not told.
            </AlertDialogDescription>
            <AlertDialogDescription>
              Only requests that were never assigned to a client can be deleted.
              Once a request belongs to a client it is kept as a record of what
              they asked for.
            </AlertDialogDescription>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={pending}
            >
              {pending ? "Deleting" : "Delete"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
