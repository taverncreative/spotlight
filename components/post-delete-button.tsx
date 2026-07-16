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
import { deletePost } from "@/lib/posts/actions";

// Per-row delete with a confirm dialog (the Slice 6 site-remove pattern).
// Calls the action directly inside a transition (no form/effect), so success
// can close the dialog and refresh without setState-in-effect; failures show
// inline instead of silently leaving the dialog open.
export function PostDeleteButton({
  postId,
  title,
  iconTrigger = false,
}: {
  postId: string;
  title: string;
  // Render the trigger as an icon-sm button (for the card grid's icon action
  // row) instead of the default text button.
  iconTrigger?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmDelete() {
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("id", postId);
        const result = await deletePost(null, formData);
        if (result?.ok) {
          setOpen(false);
          router.refresh();
        } else {
          setError(result?.error ?? "Could not delete the post.");
        }
      } catch {
        setError("Could not delete the post.");
      }
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size={iconTrigger ? "icon-sm" : "sm"}
        aria-label={iconTrigger ? `Delete "${title}"` : undefined}
        title={iconTrigger ? "Delete" : undefined}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {iconTrigger ? <Trash2 /> : "Delete"}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent size="sm">
          <div className="space-y-2">
            <AlertDialogTitle>Delete post?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes “{title}”. This cannot be undone. If this
              post is published to a live site, it may take a few minutes to
              disappear after their cache refreshes.
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
