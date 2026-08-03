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
import { deleteUnassignedRequests } from "@/lib/requests/actions";

// Clear the visible unassigned requests in one go.
//
// WHY IT EXISTS: roughly half the inbox is automated test rows saying "please
// delete", and removing them one dialog at a time is the kind of chore that
// simply does not get done.
//
// IT DELETES EXACTLY WHAT IS ON SCREEN. The ids come from the rendered list, so
// the filters in force are honoured without this component knowing they exist,
// and a request that arrives between the page rendering and the button being
// pressed is not swept up in something the operator never saw.
//
// The dialog says what is protected as well as what goes, because "delete all"
// is a frightening thing to press without knowing where the edge is.
export function RequestsBulkDelete({
  ids,
  assignedCount,
}: {
  ids: string[];
  // Requests belonging to a client. They are not on this page at all -- it lists
  // unassigned rows only -- so this is stated to answer "what about the rest?"
  // rather than to describe anything visible.
  assignedCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (ids.length === 0) return null;

  function confirmDelete() {
    startTransition(async () => {
      try {
        const result = await deleteUnassignedRequests(ids);
        if (result.ok && result.deleted === ids.length) {
          setOpen(false);
          router.refresh();
        } else if (result.ok) {
          // Short of what was asked for: the policy refused something. Say so
          // rather than closing on a half-done job that looked complete.
          setError(
            `Deleted ${result.deleted} of ${ids.length}. The rest are protected and were kept.`
          );
          router.refresh();
        } else {
          setError(result.error ?? "Could not delete the requests.");
        }
      } catch {
        setError("Could not delete the requests.");
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
        Delete {ids.length} shown
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent size="sm">
          <div className="space-y-2">
            <AlertDialogTitle>
              Delete {ids.length} {ids.length === 1 ? "request" : "requests"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the {ids.length}{" "}
              {ids.length === 1 ? "request" : "requests"} shown here. It cannot
              be undone, and the sending apps are not told.
            </AlertDialogDescription>
            <AlertDialogDescription>
              {assignedCount > 0 ? (
                <>
                  {assignedCount} {assignedCount === 1 ? "request" : "requests"}{" "}
                  assigned to a client {assignedCount === 1 ? "is" : "are"}{" "}
                  kept. Only requests that never reached a client can be
                  deleted, and none of those appear on this page.
                </>
              ) : (
                <>
                  Only requests that never reached a client can be deleted.
                  Anything assigned to a client is kept.
                </>
              )}
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
              {pending ? "Deleting" : `Delete ${ids.length}`}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
