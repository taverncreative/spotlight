"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cancelScheduledPost } from "@/lib/social/actions";

// Per-card cancel-schedule with a confirm step: back to draft, never deleted.
// Calls the action directly inside a transition (no form/effect), so success
// can close the dialog and refresh without setState-in-effect.
export function SocialCancelButton({
  postId,
  iconTrigger = false,
}: {
  postId: string;
  // Render the trigger as an icon-sm button (for the card grid's icon action
  // row) instead of the default text button.
  iconTrigger?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmCancel() {
    startTransition(async () => {
      const result = await cancelScheduledPost(postId);
      if (result?.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result?.error ?? "Could not cancel the schedule.");
      }
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size={iconTrigger ? "icon-sm" : "sm"}
        aria-label={iconTrigger ? "Cancel schedule" : undefined}
        title={iconTrigger ? "Cancel schedule" : undefined}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {iconTrigger ? <CalendarX /> : "Cancel schedule"}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent size="sm">
          <div className="space-y-2">
            <AlertDialogTitle>Cancel this schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              The post goes back to draft and will not publish. Nothing is
              deleted.
            </AlertDialogDescription>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <AlertDialogCancel type="button">Keep schedule</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={confirmCancel}
              disabled={pending}
            >
              {pending ? "Cancelling…" : "Back to draft"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
